import type { Artifact, MessageContext } from "@agent-pilot/shared";

export interface CreateDocInput {
  title: string;
  markdown: string;
}

export interface UpdateDocInput {
  artifact: Artifact;
  markdown: string;
  reason: string;
}

export interface CreateSlidesInput {
  title: string;
  markdown: string;
}

export interface ExportArtifactInput {
  artifacts: Artifact[];
  summary: string;
}

export interface OfficeToolAdapter {
  name: "mock" | "lark-cli";
  readMessages(): Promise<MessageContext>;
  createDoc(input: CreateDocInput): Promise<Artifact>;
  updateDoc(input: UpdateDocInput): Promise<Artifact>;
  createSlides(input: CreateSlidesInput): Promise<Artifact>;
  exportArtifact(input: ExportArtifactInput): Promise<Artifact>;
}

