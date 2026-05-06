import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";
import { calculateLarkSignature } from "../../apps/api/src/security/LarkEventGuard";

test.describe("Lark IM trigger API", () => {
  test.beforeEach(async ({ request }) => {
    await request.delete("/api/test/reset");
  });

  test("handles challenge and ignores non-trigger messages", async ({ request }) => {
    const health = await request.get("/health");
    await expect(health).toBeOK();
    const healthBody = await health.json();
    expect(healthBody).toMatchObject({ llm: "mock", officeAdapter: "mock" });

    const readiness = await request.get("/api/readiness");
    await expect(readiness).toBeOK();
    expect(await readiness.json()).toMatchObject({
      ok: false,
      checks: expect.arrayContaining([
        expect.objectContaining({ id: "llm", ok: false, required: true }),
        expect.objectContaining({ id: "office", ok: false, required: true }),
        expect.objectContaining({ id: "state", ok: false, required: true })
      ])
    });

    const challenge = await request.post("/api/triggers/lark-im", {
      data: { challenge: "verify-token" }
    });
    await expect(challenge).toBeOK();
    expect(await challenge.json()).toMatchObject({
      accepted: false,
      ignored: true,
      challenge: "verify-token",
      reason: "lark.challenge"
    });

    const ignored = await request.post("/api/triggers/lark-im", {
      data: {
        chatId: "oc_test",
        messageId: "om_plain",
        sender: "ou_user",
        text: "大家下午三点开会"
      }
    });
    await expect(ignored).toBeOK();
    const ignoredBody = await ignored.json();
    expect(ignoredBody).toMatchObject({
      accepted: false,
      ignored: true,
      reason: "message does not match agent trigger keywords",
      trigger: {
        source: "lark-im",
        chatId: "oc_test",
        messageId: "om_plain",
        sender: "ou_user",
        rawText: "大家下午三点开会"
      }
    });
  });

  test("creates a task from a flat trigger payload", async ({ request }) => {
    const response = await request.post("/api/triggers/lark-im", {
      data: {
        chatId: "oc_test",
        messageId: "om_trigger",
        sender: "ou_user",
        text: "@Agent 请整理群聊讨论，生成需求文档和汇报 Slides。"
      }
    });
    expect(response.status()).toBe(202);

    const body = await response.json();
    expect(body.accepted).toBe(true);
    expect(body.ignored).toBe(false);
    expect(body.task).toMatchObject({
      source: "im",
      userIntent: "请整理群聊讨论，生成需求文档和汇报 Slides。",
      trigger: {
        source: "lark-im",
        chatId: "oc_test",
        messageId: "om_trigger",
        sender: "ou_user",
        rawText: "@Agent 请整理群聊讨论，生成需求文档和汇报 Slides。"
      }
    });

    await expect
      .poll(async () => {
        const taskResponse = await request.get(`/api/tasks/${body.task.id}`);
        const taskBody = await taskResponse.json();
        return taskBody.task.status;
      }, { timeout: 12_000 })
      .toBe("waiting_user");

    const confirm = await request.post("/api/triggers/lark-im", {
      data: {
        chatId: "oc_test",
        messageId: "om_confirm",
        sender: "ou_user",
        text: "确认"
      }
    });
    expect(confirm.status()).toBe(202);
    expect(await confirm.json()).toMatchObject({
      accepted: true,
      ignored: false,
      reason: "confirmed waiting task"
    });

    await expect
      .poll(async () => {
        const taskResponse = await request.get(`/api/tasks/${body.task.id}`);
        const taskBody = await taskResponse.json();
        return taskBody.task.status;
      }, { timeout: 12_000 })
      .toBe("completed");

    const taskResponse = await request.get(`/api/tasks/${body.task.id}`);
    const taskBody = await taskResponse.json();
    const artifactUrls = taskBody.task.artifacts.map((artifact: { url?: string }) => artifact.url).filter(Boolean);
    expect(artifactUrls.length).toBeGreaterThan(0);
    expect(artifactUrls.every((url: string) => url.startsWith("mock://"))).toBe(true);
    expect(taskBody.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "tool.started" }),
        expect.objectContaining({ type: "tool.completed" }),
        expect.objectContaining({ type: "artifact.verified" })
      ])
    );
  });

  test("creates a task from a Lark event-shaped payload", async ({ request }) => {
    const response = await request.post("/api/lark/events", {
      data: {
        event: {
          message: {
            chat_id: "oc_event",
            message_id: "om_event",
            content: JSON.stringify({ text: "/agent 请整理需求，并生成 PPT。" })
          },
          sender: {
            sender_id: {
              open_id: "ou_event"
            }
          }
        }
      }
    });
    expect(response.status()).toBe(202);

    const body = await response.json();
    expect(body.accepted).toBe(true);
    expect(body.task).toMatchObject({
      source: "im",
      userIntent: "请整理需求，并生成 PPT。",
      trigger: {
        source: "lark-im",
        chatId: "oc_event",
        messageId: "om_event",
        sender: "ou_event"
      }
    });

    await expect
      .poll(async () => {
        const taskResponse = await request.get(`/api/tasks/${body.task.id}`);
        const taskBody = await taskResponse.json();
        return taskBody.task.status;
      }, { timeout: 12_000 })
      .toBe("waiting_user");
  });

  test("ignores bot self messages", async ({ request }) => {
    const response = await request.post("/api/triggers/lark-im", {
      data: {
        chatId: "oc_self",
        messageId: "om_self",
        sender: "ou_bot",
        senderType: "app",
        text: "/agent 请整理需求。"
      }
    });

    await expect(response).toBeOK();
    expect(await response.json()).toMatchObject({
      accepted: false,
      ignored: true,
      reason: "bot self message ignored",
      trigger: {
        source: "lark-im",
        chatId: "oc_self",
        messageId: "om_self",
        sender: "ou_bot"
      }
    });
  });

  test("supports progress and cancellation commands from the same chat", async ({ request }) => {
    const response = await request.post("/api/triggers/lark-im", {
      data: {
        chatId: "oc_control",
        messageId: "om_control_trigger",
        sender: "ou_user",
        text: "/agent 请整理群聊讨论，生成需求文档。"
      }
    });
    expect(response.status()).toBe(202);
    const body = await response.json();

    await expect
      .poll(async () => {
        const taskResponse = await request.get(`/api/tasks/${body.task.id}`);
        const taskBody = await taskResponse.json();
        return taskBody.task.status;
      }, { timeout: 12_000 })
      .toBe("waiting_user");

    const progress = await request.post("/api/triggers/lark-im", {
      data: {
        chatId: "oc_control",
        messageId: "om_control_progress",
        sender: "ou_user",
        text: "进度"
      }
    });
    expect(progress.status()).toBe(202);
    expect(await progress.json()).toMatchObject({
      accepted: true,
      ignored: false,
      reason: "reported task progress",
      task: {
        id: body.task.id,
        status: "waiting_user"
      }
    });

    const cancel = await request.post("/api/triggers/lark-im", {
      data: {
        chatId: "oc_control",
        messageId: "om_control_cancel",
        sender: "ou_user",
        text: "取消"
      }
    });
    expect(cancel.status()).toBe(202);
    expect(await cancel.json()).toMatchObject({
      accepted: true,
      ignored: false,
      reason: "cancelled active task"
    });

    await expect
      .poll(async () => {
        const taskResponse = await request.get(`/api/tasks/${body.task.id}`);
        const taskBody = await taskResponse.json();
        return taskBody.task.status;
      }, { timeout: 12_000 })
      .toBe("cancelled");
  });

  test("does not create a second active session for the same chat", async ({ request }) => {
    const first = await request.post("/api/triggers/lark-im", {
      data: {
        chatId: "oc_busy",
        messageId: "om_busy_first",
        sender: "ou_user",
        text: "/agent 请整理本轮讨论。"
      }
    });
    expect(first.status()).toBe(202);
    const firstBody = await first.json();

    const second = await request.post("/api/triggers/lark-im", {
      data: {
        chatId: "oc_busy",
        messageId: "om_busy_second",
        sender: "ou_user",
        text: "/agent 再生成一版新的汇报。"
      }
    });
    await expect(second).toBeOK();
    expect(await second.json()).toMatchObject({
      accepted: false,
      ignored: true,
      reason: "chat session already active",
      task: {
        id: firstBody.task.id
      }
    });
  });

  test("ignores duplicate message ids", async ({ request }) => {
    const payload = {
      chatId: "oc_test",
      messageId: "om_duplicate",
      sender: "ou_user",
      text: "/agent 请整理本轮讨论并生成交付物。"
    };

    const first = await request.post("/api/triggers/lark-im", { data: payload });
    expect(first.status()).toBe(202);
    expect((await first.json()).accepted).toBe(true);

    const second = await request.post("/api/triggers/lark-im", { data: payload });
    await expect(second).toBeOK();
    expect(await second.json()).toMatchObject({
      accepted: false,
      ignored: true,
      reason: "duplicate message ignored",
      trigger: {
        source: "lark-im",
        chatId: "oc_test",
        messageId: "om_duplicate",
        sender: "ou_user"
      }
    });
  });

  test("clarification response re-triggers planning when task is waiting_user", async ({ request }) => {
    const trigger = await request.post("/api/triggers/lark-im", {
      data: {
        chatId: "oc_clarify",
        messageId: "om_clarify_trigger",
        sender: "ou_user",
        text: "/agent 请整理本轮讨论，生成需求文档。"
      }
    });
    expect(trigger.status()).toBe(202);
    const { task } = await trigger.json();

    await expect
      .poll(async () => {
        const r = await request.get(`/api/tasks/${task.id}`);
        return (await r.json()).task.status;
      }, { timeout: 12_000 })
      .toBe("waiting_user");

    // Send a non-standard command (treated as clarification response)
    const cmdResponse = await request.post(`/api/tasks/${task.id}/commands`, {
      data: { command: "系统面向全校学生，主要用于课外活动管理" }
    });
    expect(cmdResponse.status()).toBe(200);

    // Task should re-run planning and eventually reach waiting_user again
    await expect
      .poll(async () => {
        const r = await request.get(`/api/tasks/${task.id}`);
        const body = await r.json();
        return body.task.status;
      }, { timeout: 12_000 })
      .toMatch(/waiting_user|completed/);

    // Intent should contain the supplement
    const finalTask = await (await request.get(`/api/tasks/${task.id}`)).json();
    expect(finalTask.task.userIntent).toContain("用户补充");
  });

  test("documents the Lark raw body signature algorithm", () => {
    const timestamp = "1714272000";
    const nonce = "nonce-for-test";
    const encryptKey = "encrypt-key-for-test";
    const rawBody = JSON.stringify({
      event: {
        message: {
          chat_id: "oc_signature",
          message_id: "om_signature",
          content: JSON.stringify({ text: "/agent 请整理需求。" })
        }
      }
    });

    const expected = createHash("sha256")
      .update(`${timestamp}${nonce}${encryptKey}${rawBody}`)
      .digest("hex");

    expect(calculateLarkSignature({ timestamp, nonce, encryptKey, rawBody })).toBe(expected);
  });
});
