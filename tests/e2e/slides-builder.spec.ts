import { expect, test } from "@playwright/test";
import { SlidesXmlBuilder } from "../../apps/api/src/slides/SlidesXmlBuilder";

test("builds presentation-native slides with specialized page layouts", () => {
  const slides = new SlidesXmlBuilder().build(`# Agent-Pilot 汇报

从 IM 到 Docs 与 Slides 的一键闭环

## 核心流程

- IM 捕捉任务
- Agent 规划并确认
- 生成需求文档
- 回发交付链接

讲者备注：突出 Agent 主驾驶。

## 角色与权限边界

- 学生查看活动并报名
- 老师发布活动并导出名单
- 管理员配置规则和审计
- Agent 记录执行日志

讲者备注：说明不同角色操作边界。

## 交付计划

- 第一阶段跑通主链路
- 第二阶段优化飞书内嵌页
- 第三阶段补富媒体归档

讲者备注：展示可落地路线。`);

  expect(slides.length).toBeGreaterThanOrEqual(5);
  expect(slides[0]).toContain("AGENT-PILOT / FEISHU IM COLLAB");
  expect(slides.join("\n")).toContain("FINAL DELIVERY");
  expect(slides.join("\n")).toContain("<note>");
  expect(slides.join("\n")).toContain("IM 捕捉任务");
  expect(slides.join("\n")).not.toContain("<script");
});

test("renders stats KPI cards when section emphasises numbers", () => {
  const slides = new SlidesXmlBuilder().build(`# Agent-Pilot 关键数据

## 关键指标

- 82 分：复赛预估得分
- 16 条：Playwright E2E 用例
- 7 种：Slides 模板版式
- 100 %：线上 readiness 通过

讲者备注：用四张卡片传达成果。

## 总结

- Agent 已经具备从 IM 到产物的可演示闭环
`);

  const xml = slides.join("\n");
  expect(xml).toContain("82");
  expect(xml).toContain("复赛预估得分");
  expect(xml).toMatch(/Playwright\s+E2E/);
  expect(xml).toContain("FINAL DELIVERY");
});

test("renders comparison rows when section uses → arrows", () => {
  const slides = new SlidesXmlBuilder().build(`# Agent-Pilot 升级前后

## 体验对比

- 人工搬运 IM → Agent 自动整理沉淀
- JSON 文件持久化 → SQLite 长期持久化
- 单页静态汇报 → 7 种动态版式
- 失败任务无记录 → 失败步骤可重试

讲者备注：突出 Agent 的差异化价值。

## 总结

- 升级后的体验显著提升交付效率
`);

  const xml = slides.join("\n");
  expect(xml).toContain("现状 / Before");
  expect(xml).toContain("Agent-Pilot / After");
  expect(xml).toContain("人工搬运 IM");
  expect(xml).toContain("Agent 自动整理沉淀");
});
