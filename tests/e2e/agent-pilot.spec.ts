import { expect, test } from "@playwright/test";

test.beforeEach(async ({ request }) => {
  await request.delete("/api/test/reset");
});

test("runs the IM to doc to slides agent workflow", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "飞书协同 Agent 运行台" })).toBeVisible();
  await page.getByRole("button", { name: "启动 Agent" }).click();

  await expect(page.getByText("校园活动报名系统需求文档").first()).toBeVisible({
    timeout: 12_000
  });
  await expect(page.getByText("校园活动报名系统汇报 PPT").first()).toBeVisible();
  await expect(page.getByText("3 分钟汇报讲稿与优化建议").first()).toBeVisible();

  await page.getByRole("button", { name: "发送追加修改" }).click();
  await expect(page.getByText("权限管理补充").first()).toBeVisible({
    timeout: 12_000
  });
});

test("accepts runtime API endpoint overrides for deployed dashboard", async ({ page }) => {
  await page.goto("/?api=http://localhost:18878&ws=ws://localhost:18878/ws");

  await expect(page.getByRole("heading", { name: "飞书协同 Agent 运行台" })).toBeVisible();
  await expect(page.getByLabel("API 地址")).toHaveValue("http://localhost:18878");
  await expect(page.getByLabel("WS 地址")).toHaveValue("ws://localhost:18878/ws");
  await expect(page.getByText("实时连接").first()).toBeVisible();
});
