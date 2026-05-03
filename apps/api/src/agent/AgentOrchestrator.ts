import type { AgentPlan, Artifact, Task, TaskSource, TaskTrigger } from "@agent-pilot/shared";
import type { OfficeToolAdapter } from "../adapters/OfficeToolAdapter";
import type { AgentLlm } from "../llm/AgentLlm";
import { TaskStore } from "../state/TaskStore";
import { createId, delay, nowIso } from "../utils/id";
import { ArtifactVerifier } from "./ArtifactVerifier";
import { ContentComposer } from "./ContentComposer";
import { Planner } from "./Planner";

export class AgentOrchestrator {
  private planner: Planner;
  private composer: ContentComposer;
  private verifier = new ArtifactVerifier();

  constructor(
    private readonly store: TaskStore,
    private readonly llm: AgentLlm,
    private readonly office: OfficeToolAdapter
  ) {
    this.planner = new Planner(llm);
    this.composer = new ContentComposer(llm);
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
      const context = await this.office.readMessages(task.trigger?.chatId);
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
      const context = await this.office.readMessages(task.trigger?.chatId);

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
          slidesArtifact = await this.office.createSlides({
            title: "校园活动报名系统汇报 PPT",
            markdown
          });
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
      this.store.setStatus(taskId, "failed", message);
      this.store.emit(taskId, "task.failed", { message });
    }
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
