import type { MessageContext } from "@agent-pilot/shared";

export function buildPlannerPrompt(intent: string, context: MessageContext) {
  return [
    {
      role: "system" as const,
      content:
        "你是 Agent-Pilot 的任务规划器。你负责把 IM 中的自然语言指令拆解成可执行的办公协同任务。必须输出 JSON，不要输出 Markdown。"
    },
    {
      role: "user" as const,
      content: JSON.stringify(
        {
          userIntent: intent,
          imContext: context.messages.map((message) => ({
            sender: message.sender,
            content: message.content
          })),
          outputSchema: {
            goal: "string",
            steps: [
              {
                title: "string",
                tool: "im.read | doc.create | slides.create | rehearsal.create | summary.deliver",
                inputSummary: "string",
                expectedOutput: "string"
              }
            ],
            requiredConfirmations: ["string"],
            risks: ["string"]
          }
        },
        null,
        2
      )
    }
  ];
}

export function buildDocPrompt(intent: string, context: MessageContext) {
  return [
    {
      role: "system" as const,
      content:
        "你是办公协同 Agent 的文档生成器。请把 IM 讨论整理成结构清晰的中文需求文档，使用 Markdown，内容具体，不要虚构过多业务细节。"
    },
    {
      role: "user" as const,
      content: JSON.stringify(
        {
          userIntent: intent,
          messages: context.messages.map((message) => message.content)
        },
        null,
        2
      )
    }
  ];
}

export function buildSlidesPrompt(docMarkdown: string) {
  return [
    {
      role: "system" as const,
      content:
        "你是演示稿结构设计助手。请把需求文档转成 5 页中文 PPT 内容，使用 Markdown，每页包含标题、3-5 个要点和讲者备注。"
    },
    {
      role: "user" as const,
      content: docMarkdown
    }
  ];
}

export function buildRehearsalPrompt(slidesMarkdown: string) {
  return [
    {
      role: "system" as const,
      content:
        "你是汇报排练助手。请基于 PPT 内容生成 3 分钟中文讲稿，并指出最需要加强的一页及修改建议。使用 Markdown。"
    },
    {
      role: "user" as const,
      content: slidesMarkdown
    }
  ];
}

