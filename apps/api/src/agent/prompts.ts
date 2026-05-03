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
                tool: "im.read 或 doc.create 或 slides.create 或 rehearsal.create 或 summary.deliver",
                inputSummary: "string",
                expectedOutput: "string"
              }
            ],
            requiredConfirmations: ["string"],
            risks: ["string"]
          },
          constraints: [
            "steps 至少包含 im.read、doc.create、summary.deliver",
            "如果用户要求 PPT 或演讲稿，应包含 slides.create 和 rehearsal.create",
            "tool 字段只能从允许枚举中选择，不要自造工具名"
          ]
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
        [
          "你是比赛汇报演示稿结构设计助手。请把需求文档转成 6 页中文 PPT 内容，使用 Markdown，不要输出代码块。",
          "每页使用二级标题，标题格式为“## 第 N 页：页面标题”。",
          "推荐页序：封面、背景痛点、Agent 方案、核心流程、角色权限、交付计划。",
          "每页包含 3-4 个短要点，每个要点不超过 24 个汉字。",
          "每页末尾必须包含“讲者备注：...”，用于 3 分钟排练。",
          "内容要体现 AI Agent 是主驾驶、GUI 是辅助仪表盘，并明确串联 IM、Docs、Slides。"
        ].join("\n")
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
