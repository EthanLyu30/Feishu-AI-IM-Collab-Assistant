import { spawn } from "node:child_process";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { Artifact, MessageContext } from "@agent-pilot/shared";
import type { CreateDocInput, CreateSlidesInput, ExportArtifactInput, OfficeToolAdapter, SendMessageInput, UpdateDocInput } from "./OfficeToolAdapter";
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

    const payload = this.parseJsonObject(output);
    const messages = payload as {
      data?: {
        items?: Array<{
          message_id?: string;
          sender?: { sender_type?: string };
          body?: { content?: string };
          create_time?: string | number;
        }>;
      };
      items?: Array<{
        message_id?: string;
        sender?: { sender_type?: string };
        body?: { content?: string };
        create_time?: string | number;
      }>;
    };
    const items = messages.items ?? messages.data?.items ?? [];

    return {
      source: "feishu",
      chatName: `群聊 ${chatId}`,
      messages: items.map((item, index) => ({
        id: item.message_id ?? createId("msg"),
        sender: item.sender?.sender_type === "user" ? "user" : "system",
        content: this.extractText(item.body?.content ?? ""),
        timestamp: item.create_time
          ? new Date(Number(item.create_time) * 1000).toISOString()
          : new Date(Date.now() + index).toISOString()
      }))
    };
  }

  async sendMessage(input: SendMessageInput): Promise<void> {
    const chatId = input.chatId ?? this.defaultChatId;
    if (!chatId) {
      throw new Error("Lark chat_id is required for sendMessage. Set LARK_DEFAULT_CHAT_ID or pass chatId explicitly.");
    }

    await this.run([
      "im", "+messages-send",
      "--as", "user",
      "--chat-id", chatId,
      "--markdown", input.markdown
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
      "--markdown", `@${tmpFile}`,
      "--format", "json"
    ]);

    const docUrl = this.extractUrl(output);

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
      url: this.extractUrl(input.summary),
      createdBy: "agent",
      updatedAt: nowIso()
    };
  }

  private extractText(content: string) {
    if (!content) return "";
    try {
      const parsed = JSON.parse(content) as { text?: string; title?: string; content?: unknown };
      if (typeof parsed.text === "string") return parsed.text;
      if (typeof parsed.title === "string") return parsed.title;
      return JSON.stringify(parsed);
    } catch {
      return content;
    }
  }

  private parseJsonObject(output: string): unknown {
    try {
      return JSON.parse(output);
    } catch {
      const first = output.indexOf("{");
      const last = output.lastIndexOf("}");
      if (first >= 0 && last > first) {
        return JSON.parse(output.slice(first, last + 1));
      }
      throw new Error(`lark-cli returned non-JSON output: ${output.slice(0, 500)}`);
    }
  }

  private extractUrl(output: string) {
    try {
      const json = this.parseJsonObject(output);
      const found = this.findFirstString(json, (value) => /^https?:\/\//.test(value));
      if (found) return found;
    } catch {
      // Fall back to plain text scan below.
    }

    const match = output.match(/https?:\/\/[^\s"']+/);
    return match?.[0];
  }

  private findFirstString(value: unknown, predicate: (value: string) => boolean): string | undefined {
    if (typeof value === "string") return predicate(value) ? value : undefined;
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = this.findFirstString(item, predicate);
        if (found) return found;
      }
    }
    if (value && typeof value === "object") {
      for (const item of Object.values(value)) {
        const found = this.findFirstString(item, predicate);
        if (found) return found;
      }
    }
    return undefined;
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
