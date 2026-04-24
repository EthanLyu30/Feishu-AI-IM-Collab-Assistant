import { spawn } from "node:child_process";
import type { Artifact, MessageContext } from "@agent-pilot/shared";
import type { CreateDocInput, CreateSlidesInput, ExportArtifactInput, OfficeToolAdapter, UpdateDocInput } from "./OfficeToolAdapter";
import { createId, nowIso } from "../utils/id";

export class LarkCliAdapter implements OfficeToolAdapter {
  name = "lark-cli" as const;

  constructor(private readonly cliBin: string) {}

  async readMessages(): Promise<MessageContext> {
    throw new Error("LarkCliAdapter.readMessages is not wired yet. Configure lark-cli auth and implement the IM command mapping here.");
  }

  async createDoc(input: CreateDocInput): Promise<Artifact> {
    await this.run(["docs", "+create", "--title", input.title, "--markdown", input.markdown]);
    return {
      id: createId("doc"),
      type: "doc",
      title: input.title,
      version: 1,
      content: input.markdown,
      createdBy: "agent",
      updatedAt: nowIso()
    };
  }

  async updateDoc(input: UpdateDocInput): Promise<Artifact> {
    throw new Error(`LarkCliAdapter.updateDoc is not wired yet. Reason: ${input.reason}`);
  }

  async createSlides(input: CreateSlidesInput): Promise<Artifact> {
    await this.run(["slides", "+create", "--title", input.title, "--markdown", input.markdown]);
    return {
      id: createId("slides"),
      type: "slides",
      title: input.title,
      version: 1,
      content: input.markdown,
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

