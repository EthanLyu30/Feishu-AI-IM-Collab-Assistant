import { expect, test } from "@playwright/test";

test("runs the IM to doc to slides agent workflow", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "IM 办公协同智能助手" })).toBeVisible();
  await page.locator('button[title="发送指令"]').click();

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
  await page.goto("/?api=http://localhost:8787&ws=ws://localhost:8787/ws");

  await expect(page.getByRole("heading", { name: "IM 办公协同智能助手" })).toBeVisible();
  await expect(page.getByLabel("API 地址")).toHaveValue("http://localhost:8787");
  await expect(page.getByLabel("WS 地址")).toHaveValue("ws://localhost:8787/ws");
  await expect(page.getByText("Live").first()).toBeVisible();
});
