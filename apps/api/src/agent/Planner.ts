import type { AgentPlan, AgentStep, MessageContext } from "@agent-pilot/shared";
import type { AgentLlm } from "../llm/AgentLlm";
import { createId } from "../utils/id";
import { buildPlannerPrompt } from "./prompts";

type PlannerDraft = {
  goal: string;
  steps: Array<{
    title: string;
    tool: string;
    inputSummary: string;
    expectedOutput: string;
  }>;
  requiredConfirmations?: string[];
  risks?: string[];
};

export class Planner {
  constructor(private readonly llm: AgentLlm) {}

  async plan(intent: string, context: MessageContext): Promise<AgentPlan> {
    if (this.llm.mode === "mock") {
      return this.mockPlan(intent);
    }

    const draft = await this.llm.completeJson<PlannerDraft>(buildPlannerPrompt(intent, context), {
      temperature: 0.1
    });

    return this.normalizePlan(draft, intent);
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
      requiredConfirmations: draft.requiredConfirmations ?? [],
      risks: draft.risks ?? []
    };
  }
}

