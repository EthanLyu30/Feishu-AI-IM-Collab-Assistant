import { expect, test } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Artifact } from "@agent-pilot/shared";
import { ArtifactVerifier } from "../../apps/api/src/agent/ArtifactVerifier";
import { TaskStore } from "../../apps/api/src/state/TaskStore";

test("persists tasks, events, and artifacts across TaskStore instances", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "agent-pilot-store-"));
  const statePath = join(tempDir, "tasks.json");

  try {
    const store = new TaskStore(statePath);
    const task = store.createTask({
      title: "持久化恢复测试",
      source: "im",
      userIntent: "整理需求并生成汇报材料",
      trigger: { source: "lark-im", chatId: "oc_test", messageId: "om_test" }
    });
    const artifact: Artifact = {
      id: "doc_test",
      type: "doc",
      title: "需求文档",
      version: 1,
      content: "# 需求文档\n\n## 背景\n\n## 角色\n学生和老师有不同操作边界。\n\n## 功能\n\n## 验收",
      createdBy: "agent",
      updatedAt: new Date().toISOString()
    };

    store.upsertArtifact(task.id, artifact);
    store.setStatus(task.id, "waiting_user");

    const restored = new TaskStore(statePath);
    expect(restored.getTask(task.id)).toMatchObject({
      id: task.id,
      status: "waiting_user",
      trigger: { chatId: "oc_test", messageId: "om_test" },
      artifacts: [expect.objectContaining({ id: "doc_test", type: "doc" })]
    });
    expect(restored.listEvents(task.id).length).toBeGreaterThanOrEqual(3);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("verifies generated docs and slides with actionable warnings", () => {
  const verifier = new ArtifactVerifier();
  const weakSlides: Artifact = {
    id: "slides_weak",
    type: "slides",
    title: "汇报 PPT",
    version: 1,
    content: "# 封面\n\n只有一页",
    createdBy: "agent",
    updatedAt: new Date().toISOString()
  };

  const strongDoc: Artifact = {
    id: "doc_strong",
    type: "doc",
    title: "需求文档",
    version: 1,
    content: [
      "# 校园活动报名系统需求文档",
      "本系统围绕学生报名、老师发布和管理员归档展开，覆盖 IM 协同到汇报交付。",
      "## 业务背景",
      "活动信息分散导致学生错过报名，老师难以及时掌握报名人数，后续归档也缺少统一入口。",
      "## 角色与权限边界",
      "学生可以查看活动、报名、取消报名和查看个人报名状态；老师可以发布活动、查看报名统计和导出名单；管理员负责账号、权限和归档。",
      "## 功能需求",
      "系统需要支持活动列表、报名表单、截止时间、名单导出、签到预留、消息通知和数据统计。",
      "## 非功能需求",
      "系统需要保证多端一致、操作可追踪、失败可恢复，并在网络波动时保留用户已编辑内容。",
      "权限和数据边界需要在每次关键操作中保持清晰：学生只能维护自己的报名记录，不能查看其他学生的联系方式；老师只能管理自己发布或被授权协作的活动，不能越权修改全校配置；管理员可以进行组织级配置，但所有导出、删除和权限变更都需要留下审计记录。",
      "Agent 在协同链路中负责读取群聊上下文、主动澄清缺失条件、生成结构化任务计划，并调用文档和演示稿工具完成交付。GUI 只展示状态、确认节点、失败原因和产物入口，不替代 Agent 主流程。",
      "演示时需要同时展示移动端飞书群触发、桌面端仪表盘同步、Docs 内容可读、Slides 非空白、最终群内回发链接可打开，形成从 IM 对话到汇报材料的完整闭环。",
      "## 验收标准",
      "用户可以在飞书群内触发 Agent，自动生成需求文档、演示稿和汇报讲稿，并收到可打开的交付链接。"
    ].join("\n\n"),
    createdBy: "agent",
    updatedAt: new Date().toISOString()
  };

  expect(verifier.verify(weakSlides)).toMatchObject({
    ok: false,
    metrics: { slides: 1 }
  });
  expect(verifier.verify(strongDoc)).toMatchObject({
    ok: true,
    warnings: []
  });
});
