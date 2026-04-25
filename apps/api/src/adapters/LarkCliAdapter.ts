import { spawn } from "node:child_process";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { Artifact, MessageContext } from "@agent-pilot/shared";
import type { CreateDocInput, CreateSlidesInput, ExportArtifactInput, OfficeToolAdapter, UpdateDocInput } from "./OfficeToolAdapter";
import { createId, nowIso } from "../utils/id";

export class LarkCliAdapter implements OfficeToolAdapter {
  name = "lark-cli" as const;

  constructor(
    private readonly cliBin: string,
    private readonly defaultChatId?: string
  ) {}

  async readMessages(chatId = this.defaultChatId): Promise<MessageContext> {
    if (!chatId) {
      throw new Error("Lark chat_id is required. Set LARK_DEFAULT_CHAT_ID or pass chatId explicitly.");
    }

    const output = await this.run([
      "im", "+chat-messages-list",
      "--chat-id", chatId,
      "--page-size", "20",
      "--sort", "desc",
      "--format", "json"
    ]);

    const messages = JSON.parse(output) as {
      items?: Array<{
        message_id?: string;
        sender?: { sender_type?: string };
        body?: { content?: string };
        create_time?: string | number;
      }>;
    };

    return {
      source: "feishu",
      chatName: `群聊 ${chatId}`,
      messages: (messages.items ?? []).map((item, index) => ({
        id: item.message_id ?? createId("msg"),
        sender: item.sender?.sender_type === "user" ? "user" : "system",
        content: item.body?.content ?? "",
        timestamp: item.create_time
          ? new Date(Number(item.create_time) * 1000).toISOString()
          : new Date(Date.now() + index).toISOString()
      }))
    };
  }

  async sendMessage(chatId: string, markdown: string): Promise<void> {
    const tmpDir = join(process.cwd(), ".tmp");
    await mkdir(tmpDir, { recursive: true });

    const tmpFile = join(tmpDir, `${createId("msg")}.md`);
    await writeFile(tmpFile, markdown, "utf-8");

    await this.run([
      "im", "+messages-send",
      "--as", "user",
      "--chat-id", chatId,
      "--markdown", `@${tmpFile}`
    ]);
  }

  async createDoc(input: CreateDocInput): Promise<Artifact> {
    const tmpDir = join(process.cwd(), ".tmp");
    await mkdir(tmpDir, { recursive: true });

    const tmpFile = join(tmpDir, `${createId("doc")}.md`);
    await writeFile(tmpFile, input.markdown, "utf-8");

    const output = await this.run([
      "docs", "+create",
      "--as", "user",
      "--title", input.title,
      "--markdown", `@${tmpFile}`
    ]);

    const docUrlMatch = output.match(/https?:\/\/[^\s]+/);
    const docUrl = docUrlMatch ? docUrlMatch[0] : "";

    return {
      id: createId("doc"),
      type: "doc",
      title: input.title,
      version: 1,
      content: input.markdown,
      url: docUrl,
      createdBy: "agent",
      updatedAt: nowIso()
    };
  }

  async updateDoc(input: UpdateDocInput): Promise<Artifact> {
    throw new Error(`LarkCliAdapter.updateDoc is not wired yet. Reason: ${input.reason}`);
  }

  async createSlides(input: CreateSlidesInput): Promise<Artifact> {
    return {
      id: createId("slides"),
      type: "slides",
      title: input.title,
      version: 1,
      content: input.markdown,
      url: "https://feishu.cn/slides/mock",
      createdBy: "agent",
      updatedAt: nowIso()
    };
  }

  async exportArtifact(input: ExportArtifactInput): Promise<Artifact> {
    return {
      id: createId("summary"),
      type: "summary",
      title: "飞书交付摘要",
      version: 1,
      content: input.summary,
      createdBy: "agent",
      updatedAt: nowIso()
    };
  }

  private run(args: string[]) {
    return new Promise<string>((resolve, reject) => {
      const child = spawn(this.cliBin, args, {
        stdio: ["ignore", "pipe", "pipe"],
        shell: process.platform === "win32"
      });

      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
      child.on("error", reject);
      child.on("close", (code) => {
        if (code === 0) {
          resolve(stdout);
        } else {
          reject(new Error(stderr || `lark-cli exited with code ${code}`));
        }
      });
    });
  }
}
