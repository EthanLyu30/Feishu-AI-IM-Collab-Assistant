import { sampleDiscussion, type Artifact, type MessageContext } from "@agent-pilot/shared";
import type { CreateDocInput, CreateSlidesInput, ExportArtifactInput, OfficeToolAdapter, UpdateDocInput } from "./OfficeToolAdapter";
import { createId, nowIso } from "../utils/id";

export class MockOfficeToolAdapter implements OfficeToolAdapter {
  name = "mock" as const;

  async readMessages(): Promise<MessageContext> {
    return {
      source: "mock",
      chatName: "校园活动报名系统讨论群",
      messages: sampleDiscussion
    };
  }

  async createDoc(input: CreateDocInput): Promise<Artifact> {
    return {
      id: createId("doc"),
      type: "doc",
      title: input.title,
      version: 1,
      content: input.markdown,
      url: `mock://docs/${encodeURIComponent(input.title)}`,
      createdBy: "agent",
      updatedAt: nowIso()
    };
  }

  async updateDoc(input: UpdateDocInput): Promise<Artifact> {
    return {
      ...input.artifact,
      version: input.artifact.version + 1,
      content: input.markdown,
      updatedAt: nowIso()
    };
  }

  async createSlides(input: CreateSlidesInput): Promise<Artifact> {
    return {
      id: createId("slides"),
      type: "slides",
      title: input.title,
      version: 1,
      content: input.markdown,
      url: `mock://slides/${encodeURIComponent(input.title)}`,
      createdBy: "agent",
      updatedAt: nowIso()
    };
  }

  async exportArtifact(input: ExportArtifactInput): Promise<Artifact> {
    const artifactList = input.artifacts.map((artifact) => `- ${artifact.title}: ${artifact.url}`).join("\n");
    return {
      id: createId("summary"),
      type: "summary",
      title: "任务交付摘要",
      version: 1,
      content: `${input.summary}\n\n## 交付物\n\n${artifactList}`,
      url: "mock://archive/latest",
      createdBy: "agent",
      updatedAt: nowIso()
    };
  }
}

