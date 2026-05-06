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

## 第 1 页：Agent-Pilot 校园活动报名系统

- 飞书 IM 触发，AI Agent 一键生成需求文档与汇报 PPT。

讲者备注：用一句话定位项目价值：把 IM 讨论直接沉淀为可交付的办公成果，不再依赖人工整理。

## 第 2 页：背景与痛点

- 活动报名依赖群消息，信息分散难以追踪。
- 老师每次手动统计，截止控制容易出错。
- 现有报名渠道缺少实时确认和名单导出能力。
- 目标：通过系统化工具让活动闭环线上可管理。

讲者备注：从真实团队痛点出发，说明手工流程的三个核心问题：分散、易错、低效。

## 第 3 页：Agent 解决方案

- 飞书群聊发送指令触发 Agent 任务。
- Planner 自动规划子任务并请求确认。
- 自动生成需求文档和汇报 PPT 到飞书。
- 群内回发产物链接，完成交付闭环。

讲者备注：核心流程是 IM 触发 → Planner 规划 → Docs/Slides 生成 → 群回发，演示时每步都有可验证证据。

## 第 4 页：核心功能模块

- 活动发布与列表管理（支持截止时间自动关闭）。
- 在线报名与重复报名校验（系统级防重逻辑）。
- 实时报名统计与一键名单导出。
- 角色权限控制（学生/老师/管理员分级）。
- 飞书 IM 消息触发与群内进度通知。
- Agent 执行日志可视化（事件流可追溯审计）。

讲者备注：功能模块分两层：一层是业务功能（报名/导出/统计），一层是 Agent 基础设施（触发/日志/可解释性）。

## 第 5 页：角色与权限边界

- 学生：查看活动、报名与取消报名、查看状态。
- 老师：发布和管理活动、查看统计、导出名单。
- 管理员：配置规则、审计权限、归档数据。

讲者备注：权限边界清晰是系统可信度的核心，演示时可展示三种角色的不同操作视图。

## 第 6 页：分阶段交付计划

- 第一阶段：活动发布、报名、截止校验、名单导出。
- 第二阶段：飞书内嵌页面、多端协同、权限完善。
- 第三阶段：签到、数据分析、归档与消息提醒。
- 第四阶段：多租户支持与场景模块化复用。

讲者备注：阶段化路线说明可落地性，第一阶段已经在本次演示中完整跑通。

## 第 7 页：项目总结与交付价值

- IM 到文档到 PPT 的全链路 Agent 自动化已跑通。
- 飞书真实产物链接可打开、可回发、可协作。
- 多端仪表盘展示 Agent 执行过程，可观测可复盘。

讲者备注：总结三个核心交付：自动化闭环、真实飞书产物、可解释 Agent 过程，这三点直接对应比赛评分维度。
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

