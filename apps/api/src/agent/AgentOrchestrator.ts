import type { Artifact, TaskSource } from "@agent-pilot/shared";
import type { OfficeToolAdapter } from "../adapters/OfficeToolAdapter";
import type { AgentLlm } from "../llm/AgentLlm";
import { TaskStore } from "../state/TaskStore";
import { createId, delay, nowIso } from "../utils/id";
import { ContentComposer } from "./ContentComposer";
import { Planner } from "./Planner";

export class AgentOrchestrator {
  private planner: Planner;
  private composer: ContentComposer;

  constructor(
    private readonly store: TaskStore,
    private readonly llm: AgentLlm,
    private readonly office: OfficeToolAdapter
  ) {
    this.planner = new Planner(llm);
    this.composer = new ContentComposer(llm);
  }

  createTask(input: { intent: string; source: TaskSource }) {
    const task = this.store.createTask({
      title: this.titleFromIntent(input.intent),
      source: input.source,
      userIntent: input.intent
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
    this.store.updateStep(taskId, step.id, {
      status: "completed",
      completedAt: nowIso(),
      outputSummary: "需求文档已根据用户指令完成更新。"
    });
    this.store.setStatus(taskId, "completed");

    return this.store.getTask(taskId);
  }

  private async runTask(taskId: string) {
    try {
      this.store.setStatus(taskId, "planning");
      const task = this.store.getTask(taskId);
      if (!task) throw new Error("Task not found.");

      await delay(300);
      const context = await this.office.readMessages();
      const plan = await this.planner.plan(task.userIntent, context);
      this.store.setPlan(taskId, plan);
      this.store.setStatus(taskId, "running");

      let docArtifact: Artifact | undefined;
      let slidesArtifact: Artifact | undefined;
      let rehearsalMarkdown = "";

      for (const step of plan.steps) {
        this.store.updateStep(taskId, step.id, { status: "running", startedAt: nowIso() });
        await delay(500);

        if (step.tool === "im.read") {
          this.store.updateStep(taskId, step.id, {
            status: "completed",
            completedAt: nowIso(),
            outputSummary: `已读取 ${context.chatName} 中的 ${context.messages.length} 条讨论消息。`
          });
          continue;
        }

        if (step.tool === "doc.create") {
          const markdown = await this.composer.createRequirementsDoc(task.userIntent, context);
          docArtifact = await this.office.createDoc({
            title: "校园活动报名系统需求文档",
            markdown
          });
          this.store.upsertArtifact(taskId, docArtifact);
          this.store.updateStep(taskId, step.id, {
            status: "completed",
            completedAt: nowIso(),
            outputSummary: "需求文档已生成。"
          });
          continue;
        }

        if (step.tool === "slides.create") {
          const markdown = await this.composer.createSlides(docArtifact?.content ?? "");
          slidesArtifact = await this.office.createSlides({
            title: "校园活动报名系统汇报 PPT",
            markdown
          });
          this.store.upsertArtifact(taskId, slidesArtifact);
          this.store.updateStep(taskId, step.id, {
            status: "completed",
            completedAt: nowIso(),
            outputSummary: "5 页汇报 PPT 内容已生成。"
          });
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
          this.store.updateStep(taskId, step.id, {
            status: "completed",
            completedAt: nowIso(),
            outputSummary: "汇报讲稿和优化建议已生成。"
          });
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
          this.store.emit(taskId, "task.delivered", { artifact: summary });
          if (this.office.sendMessage) {
            try {
              await this.office.sendMessage({
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
            outputSummary: "交付摘要已生成。"
          });
          continue;
        }

        this.store.updateStep(taskId, step.id, {
          status: "skipped",
          completedAt: nowIso(),
          outputSummary: `暂未实现工具：${step.tool}`
        });
      }

      this.store.setStatus(taskId, "completed");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      this.store.setStatus(taskId, "failed", message);
      this.store.emit(taskId, "task.failed", { message });
    }
  }

  private titleFromIntent(intent: string) {
    return intent.length > 28 ? `${intent.slice(0, 28)}...` : intent;
  }

  private buildDeliveryMarkdown(artifacts: Artifact[], summary: Artifact) {
    const links = artifacts
      .filter((artifact) => artifact.url)
      .map((artifact) => `- [${artifact.title}](${artifact.url})`)
      .join("\n");

    return `## Agent-Pilot 任务交付\n\n${links || "- 暂无可打开链接"}\n\n交付摘要：${summary.title}`;
  }
}
