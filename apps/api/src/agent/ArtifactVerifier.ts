import type { Artifact } from "@agent-pilot/shared";

export interface ArtifactVerification {
  ok: boolean;
  summary: string;
  warnings: string[];
  metrics: Record<string, number>;
}

export class ArtifactVerifier {
  verify(artifact: Artifact): ArtifactVerification {
    if (artifact.type === "doc") {
      return this.verifyDoc(artifact.content);
    }
    if (artifact.type === "slides") {
      return this.verifySlides(artifact.content);
    }
    if (artifact.type === "summary" || artifact.type === "export") {
      return this.verifySummary(artifact.content);
    }

    return {
      ok: Boolean(artifact.content.trim()),
      summary: artifact.content.trim() ? "产物内容已生成。" : "产物内容为空。",
      warnings: artifact.content.trim() ? [] : ["产物内容为空。"],
      metrics: { characters: artifact.content.length }
    };
  }

  private verifyDoc(markdown: string): ArtifactVerification {
    const headings = this.countHeadings(markdown);
    const characters = markdown.trim().length;
    const warnings: string[] = [];

    if (characters < 600) warnings.push("需求文档内容偏短，建议补充业务背景、角色边界和验收标准。");
    if (headings < 4) warnings.push("需求文档标题层级偏少，建议拆出功能需求、非功能需求、权限边界和交付计划。");
    if (!/权限|角色|学生|老师|管理员/.test(markdown)) {
      warnings.push("需求文档暂未明显覆盖角色或权限边界。");
    }

    return {
      ok: warnings.length === 0,
      summary: warnings.length === 0 ? "需求文档结构完整，已覆盖核心协作要素。" : "需求文档已生成，但仍有可增强项。",
      warnings,
      metrics: { headings, characters }
    };
  }

  private verifySlides(markdown: string): ArtifactVerification {
    const slides = this.countSlides(markdown);
    const characters = markdown.trim().length;
    const warnings: string[] = [];

    if (slides < 5) warnings.push("Slides 页数少于 5 页，比赛汇报建议覆盖封面、痛点、方案、流程、价值与计划。");
    if (characters < 400) warnings.push("Slides 内容偏短，可能导致飞书演示稿打开后信息密度不足。");
    if (!/讲者备注|讲稿|演练|汇报/.test(markdown)) {
      warnings.push("Slides 内容未明显包含讲者备注或汇报口径。");
    }

    return {
      ok: warnings.length === 0,
      summary: warnings.length === 0 ? `Slides 结构通过校验，共 ${slides} 页。` : `Slides 已生成，共 ${slides} 页，建议继续增强。`,
      warnings,
      metrics: { slides, characters }
    };
  }

  private verifySummary(markdown: string): ArtifactVerification {
    const characters = markdown.trim().length;
    const links = (markdown.match(/https?:\/\/\S+/g) ?? []).length;
    const warnings: string[] = [];

    if (characters < 120) warnings.push("交付摘要偏短，建议说明已生成内容、链接和下一步行动。");

    return {
      ok: warnings.length === 0,
      summary: warnings.length === 0 ? "交付摘要可用于群内回发。" : "交付摘要已生成，但还可以更完整。",
      warnings,
      metrics: { characters, links }
    };
  }

  private countHeadings(markdown: string) {
    return (markdown.match(/^#{1,3}\s+/gm) ?? []).length;
  }

  private countSlides(markdown: string) {
    const headings = this.countHeadings(markdown);
    if (headings > 0) return headings;
    return Math.max(1, markdown.split(/\n\s*\n/).filter((section) => section.trim()).length);
  }
}
