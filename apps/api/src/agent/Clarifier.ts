import { z } from "zod";
import type { MessageContext } from "@agent-pilot/shared";
import type { AgentLlm } from "../llm/AgentLlm";

const clarificationSchema = z.object({
  needsClarification: z.boolean(),
  questions: z.array(z.string()).default([])
});

export type ClarificationResult = z.infer<typeof clarificationSchema>;

export class Clarifier {
  constructor(private readonly llm: AgentLlm) {}

  async check(intent: string, context: MessageContext): Promise<ClarificationResult> {
    if (/\[用户补充\]|\[用户确认无需补充\]/.test(intent)) {
      return { needsClarification: false, questions: [] };
    }
    if (this.llm.mode !== "doubao") return { needsClarification: false, questions: [] };

    try {
      const raw = await this.llm.completeJson<unknown>(
        [
          {
            role: "system" as const,
            content: [
              "你是 Agent-Pilot 的意图评估器。",
              "判断用户指令是否足够明确，可以直接生成需求文档和 PPT。",
              "若明确（有具体主题、场景或功能描述），输出 { needsClarification: false, questions: [] }。",
              "若不明确（只有【帮我整理一下】等模糊指令），输出最多 2 个关键澄清问题。",
              "问题应具体：例如【您想整理哪方面内容？】【目标受众是谁？】【是否需要 PPT？】。",
              "必须输出 JSON，不要输出 Markdown 或解释性文字。"
            ].join("\n")
          },
          {
            role: "user" as const,
            content: JSON.stringify(
              {
                intent,
                contextMessages: context.messages.slice(0, 6).map((m) => m.content),
                outputSchema: { needsClarification: "boolean", questions: ["string，最多 2 条"] }
              },
              null,
              2
            )
          }
        ],
        { temperature: 0.1 }
      );

      const parsed = clarificationSchema.safeParse(raw);
      if (!parsed.success) return { needsClarification: false, questions: [] };
      return {
        needsClarification: parsed.data.needsClarification,
        questions: parsed.data.questions.slice(0, 2)
      };
    } catch {
      return { needsClarification: false, questions: [] };
    }
  }
}
