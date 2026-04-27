import { expect, test } from "@playwright/test";

test.describe("Lark IM trigger API", () => {
  test("handles challenge and ignores non-trigger messages", async ({ request }) => {
    const health = await request.get("/health");
    await expect(health).toBeOK();
    const healthBody = await health.json();
    expect(healthBody).toMatchObject({ llm: "mock", officeAdapter: "mock" });

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
      .toBe("completed");

    const taskResponse = await request.get(`/api/tasks/${body.task.id}`);
    const taskBody = await taskResponse.json();
    const artifactUrls = taskBody.task.artifacts.map((artifact: { url?: string }) => artifact.url).filter(Boolean);
    expect(artifactUrls.length).toBeGreaterThan(0);
    expect(artifactUrls.every((url: string) => url.startsWith("mock://"))).toBe(true);
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
});
