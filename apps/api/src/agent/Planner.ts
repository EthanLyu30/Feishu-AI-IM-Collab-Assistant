import type { AgentPlan, AgentStep, MessageContext } from "@agent-pilot/shared";
import type { AgentLlm } from "../llm/AgentLlm";
import { createId } from "../utils/id";
import { buildPlannerPrompt } from "./prompts";
import { plannerDraftSchema, type PlannerDraft } from "./schemas";

const PLANNER_TIMEOUT_MS = 25_000;

export class Planner {
  constructor(private readonly llm: AgentLlm) {}

  async plan(intent: string, context: MessageContext): Promise<AgentPlan> {
    if (this.llm.mode === "mock") {
      return this.mockPlan(intent);
    }

    try {
      const draft = await this.withTimeout(
        this.planWithRetry(intent, context),
        PLANNER_TIMEOUT_MS,
        "Planner"
      );

      return this.normalizePlan(draft, intent);
    } catch {
      return this.mockPlan(intent);
    }
  }

  private async planWithRetry(intent: string, context: MessageContext): Promise<PlannerDraft> {
    const messages = buildPlannerPrompt(intent, context);
    const first = await this.llm.completeJson<unknown>(messages, { temperature: 0.1 });
    const parsed = plannerDraftSchema.safeParse(first);
    if (parsed.success) return parsed.data;

    const retry = await this.llm.completeJson<unknown>(
      [
        ...messages,
        {
          role: "assistant",
          content: JSON.stringify(first)
        },
        {
          role: "user",
          content:
            "上一次输出不符合 schema。请只输出合法 JSON，steps[].tool 只能是 im.read、doc.create、slides.create、rehearsal.create、summary.deliver。"
        }
      ],
      { temperature: 0 }
    );
    const retryParsed = plannerDraftSchema.safeParse(retry);
    if (retryParsed.success) return retryParsed.data;

    throw new Error(`Planner output failed schema validation: ${retryParsed.error.message}`);
  }

  private mockPlan(intent: string): AgentPlan {
    return this.normalizePlan(
      {
        goal: "从 IM 讨论生成需求文档、汇报 PPT 和 3 分钟讲稿。",
        steps: [
          {
            title: "读取 IM 讨论上下文",
            tool: "im.read",
            inputSummary: "读取当前群聊中与校园活动报名系统相关的讨论。",
            expectedOutput: "获得可用于整理需求的原始讨论文本。"
          },
          {
            title: "生成需求文档",
            tool: "doc.create",
            inputSummary: "提取背景、目标用户、核心功能、权限边界和风险。",
            expectedOutput: "生成一份结构化需求文档。"
          },
          {
            title: "生成 5 页汇报 PPT",
            tool: "slides.create",
            inputSummary: "将需求文档压缩成汇报结构。",
            expectedOutput: "生成 5 页 PPT 内容：标题、痛点、方案、权限、计划。"
          },
          {
            title: "生成排练讲稿",
            tool: "rehearsal.create",
            inputSummary: "基于 PPT 内容生成 3 分钟讲稿和优化建议。",
            expectedOutput: "输出讲稿和最需要加强的页面建议。"
          },
          {
            title: "总结交付",
            tool: "summary.deliver",
            inputSummary: "汇总本次任务的文档、PPT 和讲稿。",
            expectedOutput: "形成归档摘要和交付清单。"
          }
        ],
        requiredConfirmations: ["是否需要把 PPT 生成到真实飞书 Slides 中。"],
        risks: ["飞书 API 权限未配置时会使用 Mock 产物。", "LLM 生成内容需要用户最终确认。"]
      },
      intent
    );
  }

  private normalizePlan(draft: PlannerDraft, intent: string): AgentPlan {
    const steps: AgentStep[] = (draft.steps?.length ? draft.steps : this.mockPlan(intent).steps).map(
      (step) => ({
        id: createId("step"),
        title: step.title,
        tool: step.tool,
        status: "pending",
        inputSummary: step.inputSummary,
        expectedOutput: step.expectedOutput
      })
    );

    return {
      goal: draft.goal || intent,
      steps,
      requiredConfirmations: draft.requiredConfirmations,
      risks: draft.risks
    };
  }

  private withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string) {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms.`)), timeoutMs);
      })
    ]);
  }
}
