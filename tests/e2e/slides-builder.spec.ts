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
