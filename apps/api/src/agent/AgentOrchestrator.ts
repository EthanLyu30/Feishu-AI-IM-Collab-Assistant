import {
  sampleDiscussion,
  type AgentPlan,
  type Artifact,
  type MessageContext,
  type Task,
  type TaskSource,
  type TaskTrigger
} from "@agent-pilot/shared";
import type { OfficeToolAdapter } from "../adapters/OfficeToolAdapter";
import type { AgentLlm } from "../llm/AgentLlm";
import { TaskStore } from "../state/TaskStore";
import { createId, delay, nowIso } from "../utils/id";
import { ArtifactVerifier } from "./ArtifactVerifier";
import { Clarifier } from "./Clarifier";
import { ContentComposer } from "./ContentComposer";
import { Planner } from "./Planner";

export class AgentOrchestrator {
  private planner: Planner;
  private composer: ContentComposer;
  private clarifier: Clarifier;
  private verifier = new ArtifactVerifier();

  constructor(
    private readonly store: TaskStore,
    private readonly llm: AgentLlm,
    private readonly office: OfficeToolAdapter
  ) {
    this.planner = new Planner(llm);
    this.composer = new ContentComposer(llm);
    this.clarifier = new Clarifier(llm);
  }

  createTask(input: { intent: string; source: TaskSource; trigger?: TaskTrigger }) {
    const task = this.store.createTask({
      title: this.titleFromIntent(input.intent),
      source: input.source,
      userIntent: input.intent,
      trigger: input.trigger
    });

    void this.runTask(task.id);
    return task;
  }

  async handleCommand(taskId: string, command: string) {
    const task = this.store.getTask(taskId);
    if (!task) throw new Error("Task not found.");

    const trimmed = command.trim();

    // waiting_user: route to appropriate sub-handler
    if (task.status === "waiting_user") {
      if (/^(取消|cancel|stop)$/i.test(trimmed)) {
        return this.cancelTask(taskId, command);
      }
      if (/^(确认|继续|ok|yes|confirm)$/i.test(trimmed)) {
        if (!task.plan) {
          const updatedIntent = `${task.userIntent}\n\n[用户确认无需补充] 按现有上下文继续规划和执行。`;
          this.store.emit(taskId, "user.commanded", { command, kind: "clarification-confirm" });
          this.store.updateTask(taskId, { userIntent: updatedIntent });
          void this.runTask(taskId);
          return this.store.getTask(taskId);
        }
        return this.confirmTask(taskId, command);
      }
      // Clarification response: append to intent and re-run planning
      const updatedIntent = `${task.userIntent}\n\n[用户补充] ${command}`;
      this.store.emit(taskId, "user.commanded", { command, kind: "clarification-response" });
      this.store.updateTask(taskId, { userIntent: updatedIntent });
      void this.runTask(taskId);
      return this.store.getTask(taskId);
    }

    // failed: support retry
    if (task.status === "failed" && /^(重试|retry)$/i.test(trimmed)) {
      this.store.emit(taskId, "user.commanded", { command, kind: "retry" });
      this.store.setStatus(taskId, "running");
      void (task.plan ? this.executePlannedTask(taskId) : this.runTask(taskId));
      return this.store.getTask(taskId);
    }

    this.store.emit(taskId, "user.commanded", { command });
    this.store.setStatus(taskId, "running");

    const step = {
      id: createId("step"),
      title: "根据自然语言指令迭代文档",
      tool: "doc.update",
      status: "pending" as const,
      inputSummary: command,
      expectedOutput: "更新需求文档，并保留版本记录。"
    };
    this.store.addAdHocStep(taskId, step);
    this.store.updateStep(taskId, step.id, { status: "running", startedAt: nowIso() });
    const toolStartedAt = this.startTool(taskId, step);

    try {
      const doc = task.artifacts.find((artifact) => artifact.type === "doc");
      if (!doc) {
        throw new Error("No document artifact found for follow-up command.");
      }

      const updatedMarkdown = await this.composer.applyFollowUp(doc.content, command);
      const updatedDoc = await this.office.updateDoc({
        artifact: doc,
        markdown: updatedMarkdown,
        reason: command
      });

      this.store.upsertArtifact(taskId, updatedDoc);
      const verification = this.verifyArtifact(taskId, updatedDoc);
      this.store.updateStep(taskId, step.id, {
        status: "completed",
        completedAt: nowIso(),
        outputSummary: `需求文档已根据用户指令完成更新。${verification.summary}`
      });
      this.completeTool(taskId, step, toolStartedAt, "需求文档自然语言迭代完成。", {
        artifactId: updatedDoc.id,
        verification
      });
      this.store.setStatus(taskId, "completed");

      return this.store.getTask(taskId);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Follow-up command failed.";
      this.store.updateStep(taskId, step.id, {
        status: "failed",
        completedAt: nowIso(),
        outputSummary: message
      });
      this.failTool(taskId, step, toolStartedAt, message);
      this.store.setStatus(taskId, "failed", message);
      throw error;
    }
  }

  confirmTask(taskId: string, command = "确认执行") {
    const task = this.store.getTask(taskId);
    if (!task) throw new Error("Task not found.");
    if (task.status !== "waiting_user") {
      throw new Error("Task is not waiting for confirmation.");
    }

    this.store.emit(taskId, "user.commanded", { command, kind: "confirmation" });
    this.store.emit(taskId, "task.confirmed", { command });
    this.store.setStatus(taskId, "running");
    void this.executePlannedTask(taskId);
    return this.store.getTask(taskId);
  }

  async cancelTask(taskId: string, command = "取消") {
    const task = this.store.getTask(taskId);
    if (!task) throw new Error("Task not found.");
    if (task.status === "completed" || task.status === "cancelled") {
      return task;
    }

    this.store.emit(taskId, "user.commanded", { command, kind: "cancel" });
    const cancelled = this.store.setStatus(taskId, "cancelled", "User cancelled the task.");
    this.store.emit(taskId, "task.cancelled", { command });

    if (this.office.sendMessage) {
      try {
        await this.office.sendMessage({
          chatId: task.trigger?.chatId,
          markdown: `Agent-Pilot 已取消当前任务：${task.title}`
        });
      } catch (error) {
        this.store.emit(taskId, "integration.warning", {
          message: error instanceof Error ? error.message : "Failed to send Lark cancellation message."
        });
      }
    }

    return cancelled;
  }

  async reportTaskProgress(taskId: string, command = "进度") {
    const task = this.store.getTask(taskId);
    if (!task) throw new Error("Task not found.");

    this.store.emit(taskId, "user.commanded", { command, kind: "progress" });
    const markdown = this.buildProgressMarkdown(task);

    if (this.office.sendMessage) {
      try {
        await this.office.sendMessage({
          chatId: task.trigger?.chatId,
          markdown
        });
      } catch (error) {
        this.store.emit(taskId, "integration.warning", {
          message: error instanceof Error ? error.message : "Failed to send Lark progress message."
        });
      }
    }

    return task;
  }

  private async runTask(taskId: string) {
    try {
      this.store.setStatus(taskId, "planning");
      const task = this.store.getTask(taskId);
      if (!task) throw new Error("Task not found.");

      await delay(300);
      const context = await this.readTaskContext(task, "planning");

      // Proactive clarification check before planning
      const clarification = await this.clarifier.check(task.userIntent, context);
      if (clarification.needsClarification && clarification.questions.length > 0) {
        await this.requestClarification(taskId, task, clarification.questions);
        return;
      }

      const plan = await this.planner.plan(task.userIntent, context);
      this.store.setPlan(taskId, plan);

      if (task.trigger?.source === "lark-im") {
        await this.requestConfirmation(taskId, task, plan);
        return;
      }

      await this.executePlannedTask(taskId);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      this.store.setStatus(taskId, "failed", message);
      this.store.emit(taskId, "task.failed", { message });
    }
  }

  private async executePlannedTask(taskId: string) {
    let activeTool: ActiveTool | undefined;
    try {
      const task = this.store.getTask(taskId);
      if (!task) throw new Error("Task not found.");
      const plan = task.plan;
      if (!plan) throw new Error("Task plan is required before execution.");

      this.store.setStatus(taskId, "running");
      const context = await this.readTaskContext(task, "execution");

      let docArtifact: Artifact | undefined;
      let slidesArtifact: Artifact | undefined;
      let rehearsalMarkdown = "";

      for (const step of plan.steps) {
        if (this.store.getTask(taskId)?.status === "cancelled") {
          return;
        }

        this.store.updateStep(taskId, step.id, { status: "running", startedAt: nowIso() });
        activeTool = { step, startedAtMs: this.startTool(taskId, step) };
        await delay(500);

        if (step.tool === "im.read") {
          this.store.updateStep(taskId, step.id, {
            status: "completed",
            completedAt: nowIso(),
            outputSummary: `已读取 ${context.chatName} 中的 ${context.messages.length} 条讨论消息。`
          });
          this.completeTool(taskId, step, activeTool.startedAtMs, "IM 上下文读取完成。", {
            messageCount: context.messages.length,
            chatName: context.chatName
          });
          activeTool = undefined;
          continue;
        }

        if (step.tool === "doc.create") {
          const markdown = await this.composer.createRequirementsDoc(task.userIntent, context);
          docArtifact = await this.office.createDoc({
            title: "校园活动报名系统需求文档",
            markdown
          });
          this.store.upsertArtifact(taskId, docArtifact);
          const verification = this.verifyArtifact(taskId, docArtifact);
          this.store.updateStep(taskId, step.id, {
            status: "completed",
            completedAt: nowIso(),
            outputSummary: `需求文档已生成。${verification.summary}`
          });
          this.completeTool(taskId, step, activeTool.startedAtMs, "需求文档生成完成。", {
            artifactId: docArtifact.id,
            verification
          });
          activeTool = undefined;
          continue;
        }

        if (step.tool === "slides.create") {
          const markdown = await this.composer.createSlides(docArtifact?.content ?? "");
          try {
            slidesArtifact = await this.office.createSlides({
              title: "校园活动报名系统汇报 PPT",
              markdown
            });
          } catch (error) {
            const message = error instanceof Error ? error.message : "Slides creation failed.";
            this.store.emit(taskId, "integration.warning", {
              message:
                "飞书 Slides 创建失败，已保留仪表盘内演示稿草稿并继续执行讲稿和交付摘要。真实 Slides 演示前请在飞书开放平台开通 slides:presentation:create 权限。",
              originalError: message
            });
            slidesArtifact = {
              id: createId("slides"),
              type: "slides",
              title: "校园活动报名系统汇报 PPT 草稿",
              version: 1,
              content: markdown,
              url: "mock://slides/degraded",
              createdBy: "agent",
              updatedAt: nowIso()
            };
          }
          this.store.upsertArtifact(taskId, slidesArtifact);
          const verification = this.verifyArtifact(taskId, slidesArtifact);
          this.store.updateStep(taskId, step.id, {
            status: "completed",
            completedAt: nowIso(),
            outputSummary: `5 页汇报 PPT 内容已生成。${verification.summary}`
          });
          this.completeTool(taskId, step, activeTool.startedAtMs, "演示稿生成完成。", {
            artifactId: slidesArtifact.id,
            verification
          });
          activeTool = undefined;
          continue;
        }

        if (step.tool === "rehearsal.create") {
          rehearsalMarkdown = await this.composer.createRehearsal(slidesArtifact?.content ?? "");
          const rehearsalArtifact: Artifact = {
            id: createId("summary"),
            type: "summary",
            title: "3 分钟汇报讲稿与优化建议",
            version: 1,
            content: rehearsalMarkdown,
            url: "mock://rehearsal/latest",
            createdBy: "agent",
            updatedAt: nowIso()
          };
          this.store.upsertArtifact(taskId, rehearsalArtifact);
          const verification = this.verifyArtifact(taskId, rehearsalArtifact);
          this.store.updateStep(taskId, step.id, {
            status: "completed",
            completedAt: nowIso(),
            outputSummary: `汇报讲稿和优化建议已生成。${verification.summary}`
          });
          this.completeTool(taskId, step, activeTool.startedAtMs, "汇报讲稿生成完成。", {
            artifactId: rehearsalArtifact.id,
            verification
          });
          activeTool = undefined;
          continue;
        }

        if (step.tool === "summary.deliver") {
          const currentTask = this.store.getTask(taskId);
          const currentArtifacts = currentTask?.artifacts ?? [];
          const summary = await this.office.exportArtifact({
            artifacts: currentArtifacts,
            summary:
              rehearsalMarkdown ||
              "本次任务已完成需求文档、演示稿和汇报讲稿生成，后续可接入真实飞书链接。"
          });
          this.store.upsertArtifact(taskId, summary);
          const verification = this.verifyArtifact(taskId, summary);
          this.store.emit(taskId, "task.delivered", { artifact: summary });
          if (this.office.sendMessage) {
            try {
              await this.office.sendMessage({
                chatId: currentTask?.trigger?.chatId,
                markdown: this.buildDeliveryMarkdown(currentArtifacts, summary)
              });
            } catch (error) {
              this.store.emit(taskId, "integration.warning", {
                message: error instanceof Error ? error.message : "Failed to send Lark delivery message."
              });
            }
          }
          this.store.updateStep(taskId, step.id, {
            status: "completed",
            completedAt: nowIso(),
            outputSummary: `交付摘要已生成。${verification.summary}`
          });
          this.completeTool(taskId, step, activeTool.startedAtMs, "交付摘要回传完成。", {
            artifactId: summary.id,
            verification
          });
          activeTool = undefined;
          continue;
        }

        this.store.updateStep(taskId, step.id, {
          status: "skipped",
          completedAt: nowIso(),
          outputSummary: `暂未实现工具：${step.tool}`
        });
        this.completeTool(taskId, step, activeTool.startedAtMs, `暂未实现工具：${step.tool}`, {
          skipped: true
        });
        activeTool = undefined;
      }

      if (this.store.getTask(taskId)?.status !== "cancelled") {
        this.store.setStatus(taskId, "completed");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      if (activeTool) {
        this.failTool(taskId, activeTool.step, activeTool.startedAtMs, message);
      }
      const suggestion = this.getRecoverySuggestion(activeTool?.step.tool, message);
      this.store.setStatus(taskId, "failed", message);
      this.store.emit(taskId, "task.failed", {
        message,
        failedStep: activeTool?.step.title,
        failedTool: activeTool?.step.tool,
        suggestion
      });

      const failedTask = this.store.getTask(taskId);
      if (this.office.sendMessage && failedTask?.trigger?.chatId) {
        try {
          await this.office.sendMessage({
            chatId: failedTask.trigger.chatId,
            markdown: [
              "Agent-Pilot 任务执行失败",
              "",
              `失败步骤：${activeTool?.step.title ?? "未知"}`,
              `错误：${message}`,
              "",
              `恢复建议：${suggestion}`
            ].join("\n")
          });
        } catch {
          // ignore send failure during error handling
        }
      }
    }
  }

  private async requestClarification(taskId: string, task: Task, questions: string[]) {
    const markdown = this.buildClarificationMarkdown(questions);
    this.store.setStatus(taskId, "waiting_user");
    this.store.emit(taskId, "task.waiting_confirmation", {
      chatId: task.trigger?.chatId,
      kind: "clarification",
      questions,
      message: markdown
    });

    if (!this.office.sendMessage) return;
    try {
      await this.office.sendMessage({ chatId: task.trigger?.chatId, markdown });
    } catch (error) {
      this.store.emit(taskId, "integration.warning", {
        message: error instanceof Error ? error.message : "Failed to send clarification message."
      });
    }
  }

  private async readTaskContext(task: Task, phase: "planning" | "execution"): Promise<MessageContext> {
    try {
      return await this.office.readMessages(task.trigger?.chatId);
    } catch (error) {
      const originalError = error instanceof Error ? error.message : "Unknown chat read error";
      const isBotOutOfChat = originalError.includes("Bot/User can NOT be out of the chat");
      const guidance = isBotOutOfChat
        ? "飞书机器人不在当前配置的测试群内，或 LARK_DEFAULT_CHAT_ID 已不是机器人所在群。"
        : "读取飞书群聊上下文失败。";

      this.store.emit(task.id, "integration.warning", {
        message: `${guidance} 已降级使用当前任务指令和内置样例讨论继续生成产物，真实 IM 演示前请重新把机器人加入测试群并核对 chat_id。`,
        phase,
        originalError
      });

      return {
        source: "mock",
        chatName: "Web 输入降级上下文",
        messages: [
          ...sampleDiscussion,
          {
            id: createId("msg"),
            sender: "user",
            content: task.userIntent,
            timestamp: nowIso()
          }
        ]
      };
    }
  }

  private buildClarificationMarkdown(questions: string[]) {
    return [
      "Agent-Pilot 需要在开始前确认一些信息：",
      "",
      ...questions.map((q, i) => `${i + 1}. ${q}`),
      "",
      "请回复您的补充说明，Agent 收到后将继续规划和执行。",
      "如果无需修改，回复【确认】即可跳过。"
    ].join("\n");
  }

  private getRecoverySuggestion(tool: string | undefined, message: string): string {
    if (!tool) return "请检查服务状态后，回复【重试】重新执行。";
    if (message.toLowerCase().includes("auth") || message.includes("401") || message.includes("403")) {
      return "认证失败。请重新运行 lark-cli auth login 完成飞书授权，然后回复【重试】。";
    }
    if (message.toLowerCase().includes("timeout")) {
      return "请求超时。请检查网络连接，然后回复【重试】重新执行。";
    }
    if (tool === "doc.create" || tool === "doc.update") {
      return "文档操作失败。请确认飞书授权有效且有 Docs 写入权限，然后回复【重试】。";
    }
    if (tool === "slides.create") {
      return "PPT 创建失败。请确认 lark-cli 可用且有 Slides 权限，然后回复【重试】。";
    }
    if (tool === "im.read") {
      return "消息读取失败。请检查群 ID 配置和飞书权限，然后回复【重试】。";
    }
    return "请回复【重试】重新执行失败步骤，或回复【取消】终止任务。";
  }

  private async requestConfirmation(taskId: string, task: Task, plan: AgentPlan) {
    const markdown = this.buildConfirmationMarkdown(plan);
    this.store.setStatus(taskId, "waiting_user");
    this.store.emit(taskId, "task.waiting_confirmation", {
      chatId: task.trigger?.chatId,
      requiredConfirmations: plan.requiredConfirmations,
      message: markdown
    });

    if (!this.office.sendMessage) return;

    try {
      await this.office.sendMessage({
        chatId: task.trigger?.chatId,
        markdown
      });
    } catch (error) {
      this.store.emit(taskId, "integration.warning", {
        message: error instanceof Error ? error.message : "Failed to send Lark confirmation message."
      });
    }
  }

  private titleFromIntent(intent: string) {
    return intent.length > 28 ? `${intent.slice(0, 28)}...` : intent;
  }

  private verifyArtifact(taskId: string, artifact: Artifact) {
    const verification = this.verifier.verify(artifact);
    this.store.emit(taskId, "artifact.verified", {
      artifactId: artifact.id,
      artifactType: artifact.type,
      ...verification
    });

    if (verification.warnings.length > 0) {
      this.store.emit(taskId, "integration.warning", {
        message: `${artifact.title} 质量校验建议：${verification.warnings.join("；")}`,
        artifactId: artifact.id,
        artifactType: artifact.type,
        warnings: verification.warnings
      });
    }

    return verification;
  }

  private startTool(taskId: string, step: { id: string; title: string; tool: string; inputSummary?: string }) {
    const startedAtMs = Date.now();
    this.store.emit(taskId, "tool.started", {
      stepId: step.id,
      tool: step.tool,
      title: step.title,
      inputSummary: step.inputSummary
    });
    return startedAtMs;
  }

  private completeTool(
    taskId: string,
    step: { id: string; title: string; tool: string },
    startedAtMs: number,
    outputSummary: string,
    extra: Record<string, unknown> = {}
  ) {
    this.store.emit(taskId, "tool.completed", {
      stepId: step.id,
      tool: step.tool,
      title: step.title,
      durationMs: Date.now() - startedAtMs,
      outputSummary,
      ...extra
    });
  }

  private failTool(
    taskId: string,
    step: { id: string; title: string; tool: string },
    startedAtMs: number,
    message: string
  ) {
    this.store.emit(taskId, "tool.failed", {
      stepId: step.id,
      tool: step.tool,
      title: step.title,
      durationMs: Date.now() - startedAtMs,
      message
    });
  }

  private buildDeliveryMarkdown(artifacts: Artifact[], summary: Artifact) {
    const links = artifacts
      .filter((artifact) => artifact.url)
      .map((artifact) => `- [${artifact.title}](${artifact.url})`)
      .join("\n");

    return `## Agent-Pilot 任务交付\n\n${links || "- 暂无可打开链接"}\n\n交付摘要：${summary.title}`;
  }

  private buildConfirmationMarkdown(plan: AgentPlan) {
    const steps = plan.steps.map((step, index) => `${index + 1}. ${step.title}`).join("\n");
    const confirmations =
      plan.requiredConfirmations.length > 0
        ? plan.requiredConfirmations.map((item) => `- ${item}`).join("\n")
        : "- 确认开始生成飞书 Docs、Slides 和交付摘要";

    return [
      "Agent-Pilot 已完成任务规划，等待确认后继续执行。",
      "",
      `目标：${plan.goal}`,
      "",
      "执行步骤：",
      steps,
      "",
      "需要你确认：",
      confirmations,
      "",
      plan.risks.length > 0 ? "我已识别的风险：" : "",
      plan.risks.length > 0 ? plan.risks.map((item) => `- ${item}`).join("\n") : "",
      "",
      "可用指令：回复“确认/继续”开始执行，回复“进度”查看状态，回复“取消”终止任务。"
    ].filter(Boolean).join("\n");
  }

  private buildProgressMarkdown(task: Task) {
    const completedSteps = task.plan?.steps.filter((step) => step.status === "completed").length ?? 0;
    const totalSteps = task.plan?.steps.length ?? 0;
    const artifacts = task.artifacts
      .filter((artifact) => artifact.url)
      .map((artifact) => `- ${artifact.title}：${artifact.url}`)
      .join("\n");

    return [
      "Agent-Pilot 当前任务进度",
      "",
      `任务：${task.title}`,
      `状态：${task.status}`,
      totalSteps > 0 ? `步骤：${completedSteps}/${totalSteps} 已完成` : "步骤：规划中",
      "",
      "已生成产物：",
      artifacts || "- 暂无",
      "",
      task.status === "waiting_user" ? "当前正在等待群内回复“确认”或“取消”。" : "我会继续同步后续进展。"
    ].join("\n");
  }
}

interface ActiveTool {
  step: { id: string; title: string; tool: string };
  startedAtMs: number;
}
