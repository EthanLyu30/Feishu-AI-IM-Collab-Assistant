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
  const systemInstructions = [
    "你是比赛汇报演示稿结构设计助手。请把需求文档转成 7-8 页中文 PPT 内容，使用 Markdown，不要输出代码块。",
    "每页使用二级标题，标题格式为：## 第 N 页：页面标题",
    "推荐页序：1.封面 2.背景与痛点 3.Agent解决方案 4.核心功能模块 5.角色权限 6.技术亮点 7.交付计划 8.总结",
    "封面页：副标题说明核心价值，1-2 行。",
    "背景与痛点：3-4 个具体问题，带数字量化。",
    "Agent解决方案：飞书 IM 触发 -> Planner -> Doc/Slides -> 群回发的完整闭环。",
    "核心功能模块：5-6 个要点，体现业务功能与 Agent 基础设施两个维度。",
    "角色权限：明确区分 3 类角色及其操作范围。",
    "技术亮点：豆包、飞书 API、WebSocket、低成本部署等，4-5 条。",
    "交付计划：3-4 个阶段，每阶段有具体里程碑。",
    "格式要求：每页包含 3-6 个短要点，每个要点不超过 28 个汉字，优先具体可量化。",
    "每页末尾必须包含讲者备注，格式为：讲者备注：...（2-3 句具体讲解提示）",
    "讲者备注要说明该页重点、数据支撑和演示时的切入角度。",
    "内容要体现：AI Agent 是主驾驶、GUI 是辅助仪表盘；明确串联 IM、Docs、Slides；内容不要空泛，要有具体细节。"
  ].join("\n");

  return [
    {
      role: "system" as const,
      content: systemInstructions
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
