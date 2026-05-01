import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Artifact, MessageContext } from "@agent-pilot/shared";
import type { CreateDocInput, CreateSlidesInput, ExportArtifactInput, OfficeToolAdapter, SendMessageInput, UpdateDocInput } from "./OfficeToolAdapter";
import { SlidesXmlBuilder } from "../slides/SlidesXmlBuilder";
import { createId, nowIso } from "../utils/id";

export class LarkCliAdapter implements OfficeToolAdapter {
  name = "lark-cli" as const;
  private readonly timeoutMs: number;
  private readonly readRetries: number;

  constructor(
    private readonly cliBin: string,
    private readonly defaultChatId?: string,
    options: LarkCliAdapterOptions = {}
  ) {
    this.timeoutMs = options.timeoutMs ?? 45_000;
    this.readRetries = options.readRetries ?? 1;
  }

  async readMessages(chatId = this.defaultChatId): Promise<MessageContext> {
    if (!chatId) {
      throw new Error("Lark chat_id is required. Set LARK_DEFAULT_CHAT_ID or pass chatId explicitly.");
    }

    const output = await this.run(
      [
        "im", "+chat-messages-list",
        "--chat-id", chatId,
        "--page-size", "20",
        "--sort", "desc",
        "--format", "json"
      ],
      { operation: "read chat messages", retries: this.readRetries }
    );

    const payload = this.parseJsonObject(output);
    const messages = payload as {
      data?: {
        items?: LarkMessageItem[];
        messages?: LarkMessageItem[];
      };
      items?: LarkMessageItem[];
      messages?: LarkMessageItem[];
    };
    const items = messages.items ?? messages.messages ?? messages.data?.items ?? messages.data?.messages ?? [];
    const visibleItems = items.filter((item) => !item.deleted && this.extractText(this.getMessageContent(item)).trim());

    return {
      source: "feishu",
      chatName: `群聊 ${chatId}`,
      messages: visibleItems.map((item, index) => ({
        id: item.message_id ?? createId("msg"),
        sender: item.sender?.sender_type === "user" ? "user" : "system",
        content: this.extractText(this.getMessageContent(item)),
        timestamp: this.parseTimestamp(item.create_time, index)
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
      "--text", this.markdownToPlainText(input.markdown)
    ]);
  }

  async createDoc(input: CreateDocInput): Promise<Artifact> {
    const tmpDir = join(process.cwd(), ".tmp");
    await mkdir(tmpDir, { recursive: true });

    const tmpFileName = `${createId("doc")}.md`;
    const tmpFile = join(tmpDir, tmpFileName);
    await writeFile(tmpFile, input.markdown, "utf-8");

    const output = await this.run([
      "docs", "+create",
      "--as", "user",
      "--title", input.title,
      "--markdown", `@./.tmp/${tmpFileName}`
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
    if (!input.artifact.url) {
      throw new Error("LarkCliAdapter.updateDoc requires an artifact URL.");
    }

    const tmpFileName = await this.writeMarkdownTempFile(input.markdown, "doc-update");

    await this.run([
      "docs", "+update",
      "--as", "user",
      "--doc", input.artifact.url,
      "--mode", "overwrite",
      "--markdown", `@./.tmp/${tmpFileName}`
    ]);

    return {
      ...input.artifact,
      version: input.artifact.version + 1,
      content: input.markdown,
      updatedAt: nowIso()
    };
  }

  async createSlides(input: CreateSlidesInput): Promise<Artifact> {
    const output = await this.run([
      "slides", "+create",
      "--as", "user",
      "--title", input.title,
      "--slides", JSON.stringify(new SlidesXmlBuilder().build(input.markdown))
    ]);
    const slidesUrl = this.extractUrl(output);

    return {
      id: createId("slides"),
      type: "slides",
      title: input.title,
      version: 1,
      content: input.markdown,
      url: slidesUrl,
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

  private getMessageContent(item: LarkMessageItem) {
    return item.body?.content ?? item.content ?? "";
  }

  private parseTimestamp(value: string | number | undefined, fallbackIndex: number) {
    if (typeof value === "number" || /^\d+$/.test(value ?? "")) {
      return new Date(Number(value) * 1000).toISOString();
    }

    if (value) {
      const normalized = value.includes("T") ? value : value.replace(" ", "T") + "+08:00";
      const parsed = new Date(normalized);
      if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
    }

    return new Date(Date.now() + fallbackIndex).toISOString();
  }

  private async writeMarkdownTempFile(markdown: string, prefix: string) {
    const tmpDir = join(process.cwd(), ".tmp");
    await mkdir(tmpDir, { recursive: true });

    const tmpFileName = `${createId(prefix)}.md`;
    await writeFile(join(tmpDir, tmpFileName), markdown, "utf-8");
    return tmpFileName;
  }

  private markdownToPlainText(markdown: string) {
    return markdown
      .replace(/^#{1,6}\s*/gm, "")
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1：$2")
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .trim();
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

  private async run(args: string[], options: RunOptions = {}) {
    const attempts = (options.retries ?? 0) + 1;
    let lastError: unknown;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        return await this.runOnce(args, options.operation, attempt);
      } catch (error) {
        lastError = error;
        if (attempt < attempts) {
          await this.wait(300 * attempt);
        }
      }
    }

    throw lastError instanceof Error ? lastError : new Error("lark-cli command failed.");
  }

  private runOnce(args: string[], operation = "lark-cli command", attempt = 1) {
    return new Promise<string>((resolve, reject) => {
      const command = this.buildCommand(args);
      const child = spawn(command.bin, command.args, {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true
      });

      let stdout = "";
      let stderr = "";
      let settled = false;
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, this.timeoutMs);

      const finish = (error: Error | undefined, output?: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) {
          reject(error);
          return;
        }
        resolve(output ?? "");
      };

      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
      child.on("error", (error) => {
        finish(new Error(`${operation} failed to start on attempt ${attempt}: ${error.message}`));
      });
      child.on("close", (code) => {
        if (timedOut) {
          finish(
            new Error(
              `${operation} timed out after ${this.timeoutMs}ms on attempt ${attempt}: ${args.join(" ")}`
            )
          );
          return;
        }

        if (code === 0) {
          finish(undefined, stdout);
        } else {
          const detail = (stderr || stdout || `lark-cli exited with code ${code}`).slice(0, 2_000);
          finish(new Error(`${operation} failed on attempt ${attempt}: ${detail}`));
        }
      });
    });
  }

  private wait(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private buildCommand(args: string[]) {
    if (process.platform !== "win32") {
      return { bin: this.cliBin, args };
    }

    const runJs = this.resolveWindowsRunJs();
    if (runJs) {
      return { bin: process.execPath, args: [runJs, ...args] };
    }

    return { bin: this.cliBin, args };
  }

  private resolveWindowsRunJs() {
    const wrapperDir =
      /[\\/]/.test(this.cliBin) ? dirname(this.cliBin.replace(/\.(cmd|ps1)$/i, "")) : undefined;
    const candidates = [
      wrapperDir
        ? join(wrapperDir, "node_modules", "@larksuite", "cli", "scripts", "run.js")
        : undefined,
      join(process.cwd(), "node_modules", "@larksuite", "cli", "scripts", "run.js"),
      process.env.APPDATA
        ? join(process.env.APPDATA, "npm", "node_modules", "@larksuite", "cli", "scripts", "run.js")
        : undefined,
      process.env.npm_config_prefix
        ? join(process.env.npm_config_prefix, "node_modules", "@larksuite", "cli", "scripts", "run.js")
        : undefined
    ];

    return candidates.find((candidate): candidate is string => Boolean(candidate && existsSync(candidate)));
  }
}

export interface LarkCliAdapterOptions {
  timeoutMs?: number;
  readRetries?: number;
}

interface RunOptions {
  operation?: string;
  retries?: number;
}

interface LarkMessageItem {
  message_id?: string;
  sender?: { sender_type?: string };
  body?: { content?: string };
  content?: string;
  create_time?: string | number;
  deleted?: boolean;
}
