import type { MessageContext } from "@agent-pilot/shared";
import type { AgentLlm } from "../llm/AgentLlm";
import { buildDocPrompt, buildRehearsalPrompt, buildSlidesPrompt } from "./prompts";

export class ContentComposer {
  constructor(private readonly llm: AgentLlm) {}

  async createRequirementsDoc(intent: string, context: MessageContext) {
    if (this.llm.mode === "doubao") {
      return this.llm.completeText(buildDocPrompt(intent, context), { temperature: 0.2 });
    }

    return `# 校园活动报名系统需求文档

## 1. 背景与痛点

当前校园活动报名主要依赖群消息、人工表格和线下统计，存在信息分散、报名截止难控制、名单导出繁琐和后续签到衔接弱等问题。

## 2. 目标用户

- 学生：查看活动、提交报名、查看报名状态。
- 老师：发布活动、查看报名人数、导出报名名单。
- 管理员：维护活动分类、用户权限和系统配置。

## 3. 核心功能

- 活动发布：老师填写活动名称、时间、地点、容量和截止时间。
- 活动浏览：学生查看可报名活动列表和活动详情。
- 在线报名：学生提交报名信息，系统校验是否重复报名。
- 截止控制：超过报名截止时间后禁止新增报名。
- 名单导出：老师导出报名名单，用于活动组织和签到。
- 签到扩展：后续支持基于报名名单进行现场签到。

## 4. 权限边界

- 学生只能操作自己的报名记录。
- 老师只能管理自己发布的活动和报名名单。
- 管理员可以查看和维护全部活动数据。

## 5. 风险与待确认

- 报名人数上限与候补机制需要确认。
- 导出字段需要与老师实际工作流对齐。
- 签到功能是否进入第一期范围需要确认。
`;
  }

  async createSlides(docMarkdown: string) {
    if (this.llm.mode === "doubao") {
      return this.llm.completeText(buildSlidesPrompt(docMarkdown), { temperature: 0.2 });
    }

    return `# 校园活动报名系统汇报 PPT

## 第 1 页：项目背景

- 校园活动报名目前依赖群消息和人工表格。
- 信息分散，统计与截止控制成本高。
- 目标是让活动发布、报名、统计形成线上闭环。

讲者备注：先用团队日常协作痛点引入，说明为什么需要系统化工具。

## 第 2 页：用户与痛点

- 学生需要快速查看活动并完成报名。
- 老师需要发布活动并掌握报名情况。
- 管理员需要统一维护权限和数据。

讲者备注：强调不同角色的诉求不同，系统必须支持清晰权限边界。

## 第 3 页：核心流程

- 老师发布活动。
- 学生浏览活动并提交报名。
- 系统进行截止时间和重复报名校验。
- 老师导出名单并用于后续签到。

讲者备注：这一页是方案闭环重点，建议后续补一张流程图。

## 第 4 页：功能模块与权限

- 活动管理。
- 报名管理。
- 名单导出。
- 权限控制。
- 签到扩展。

讲者备注：说明第一期优先保证报名闭环，签到作为扩展能力。

## 第 5 页：交付计划

- 第一阶段：活动发布、列表、报名、截止校验。
- 第二阶段：名单导出、报名统计、权限完善。
- 第三阶段：签到、数据分析和消息提醒。

讲者备注：用阶段化计划体现可落地性，避免一次性范围过大。
`;
  }

  async createRehearsal(slidesMarkdown: string) {
    if (this.llm.mode === "doubao") {
      return this.llm.completeText(buildRehearsalPrompt(slidesMarkdown), { temperature: 0.2 });
    }

    return `# 3 分钟汇报讲稿

大家好，我们这次要解决的是校园活动报名过程中的协同问题。现在很多活动依赖群消息和人工表格收集报名，信息容易分散，老师统计成本高，学生也很难确认自己是否报名成功。

我们的方案是建设一个校园活动报名系统，让老师可以发布活动，学生可以在线查看和报名，系统自动处理截止时间和重复报名校验，最后老师可以直接导出报名名单，用于活动组织和后续签到。

第一期我们会优先完成活动发布、活动列表、在线报名和截止控制，保证核心报名闭环可用。第二期补充名单导出、报名统计和权限管理。第三期再扩展签到和消息提醒。

当前 PPT 中最需要加强的是第 3 页。建议把核心流程改成流程图，突出“老师发布活动 -> 学生报名 -> 系统校验 -> 老师导出名单 -> 活动签到”的闭环。
`;
  }

  async applyFollowUp(docMarkdown: string, command: string) {
    if (this.llm.mode === "doubao") {
      return this.llm.completeText(
        [
          {
            role: "system",
            content:
              "你是文档编辑 Agent。请根据用户追加指令修改现有需求文档，保持 Markdown 格式，只输出完整修改后的文档。"
          },
          {
            role: "user",
            content: JSON.stringify({ command, docMarkdown }, null, 2)
          }
        ],
        { temperature: 0.2 }
      );
    }

    return `${docMarkdown}

## 6. 权限管理补充

学生端权限：

- 查看已发布且未过期的活动。
- 提交、修改或取消自己的报名。
- 查看自己的报名状态，不可查看他人报名信息。

老师端权限：

- 创建和编辑自己发布的活动。
- 查看自己活动的报名统计。
- 导出自己活动的报名名单。
- 关闭报名或调整截止时间。

管理员端权限：

- 管理全部活动和用户权限。
- 审计导出记录。
- 配置活动分类、容量限制和系统级规则。
`;
  }
}

