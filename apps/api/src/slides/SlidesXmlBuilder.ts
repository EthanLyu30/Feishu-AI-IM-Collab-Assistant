interface SlideSection {
  title: string;
  body: string[];
  notes?: string;
}

export class SlidesXmlBuilder {
  build(markdown: string) {
    const sections = this.parseSections(markdown).slice(0, 10);
    const slides =
      sections.length > 0
        ? sections
        : [{ title: "Agent-Pilot 汇报", body: ["暂无演示内容"] }];

    return slides.map((section, index) => this.buildSlide(section, index));
  }

  private parseSections(markdown: string): SlideSection[] {
    const sections: SlideSection[] = [];
    let current: SlideSection | undefined;

    for (const rawLine of markdown.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line) continue;

      const heading = line.match(/^#{1,3}\s+(.+)$/);
      if (heading) {
        if (current) sections.push(current);
        current = { title: heading[1], body: [] };
        continue;
      }

      if (!current) {
        current = { title: "汇报页", body: [] };
      }

      if (/^讲者备注[:：]/.test(line)) {
        current.notes = line.replace(/^讲者备注[:：]\s*/, "");
        continue;
      }

      current.body.push(line.replace(/^[-*]\s+/, ""));
    }

    if (current) sections.push(current);
    return sections.map((section) => ({
      title: this.cleanText(section.title),
      body: section.body.map((item) => this.cleanText(item)).filter(Boolean).slice(0, 5),
      notes: section.notes ? this.cleanText(section.notes) : undefined
    }));
  }

  private buildSlide(section: SlideSection, index: number) {
    if (index === 0) {
      return this.coverSlide(section);
    }
    return this.contentSlide(section, index);
  }

  private coverSlide(section: SlideSection) {
    const subtitle = section.body[0] ?? "从 IM 对话到文档与演示稿的一键智能闭环";
    return `<slide>
  <style>
    <fill>
      <fillColor color="linear-gradient(135deg,rgba(15,23,42,1) 0%,rgba(37,99,235,1) 100%)"/>
    </fill>
  </style>
  <data>
    <shape type="text" topLeftX="80" topLeftY="150" width="800" height="120">
      <content textType="title" textAlign="center" fontSize="46" color="rgb(255,255,255)">
        <p>${this.escapeXml(section.title)}</p>
      </content>
    </shape>
    <shape type="text" topLeftX="140" topLeftY="285" width="680" height="80">
      <content textType="sub-headline" textAlign="center" fontSize="24" color="rgb(219,234,254)">
        <p>${this.escapeXml(subtitle)}</p>
      </content>
    </shape>
    <line startX="360" startY="390" endX="600" endY="390">
      <border color="rgb(147,197,253)" width="4"/>
    </line>
  </data>
</slide>`;
  }

  private contentSlide(section: SlideSection, index: number) {
    const bodyXml = this.bodyXml(section.body);
    const noteXml = section.notes
      ? `<note><content textType="body"><p>${this.escapeXml(section.notes)}</p></content></note>`
      : "";

    return `<slide>
  <style>
    <fill>
      <fillColor color="rgb(248,250,252)"/>
    </fill>
  </style>
  <data>
    <shape type="text" topLeftX="64" topLeftY="42" width="760" height="72">
      <content textType="headline" fontSize="30" color="rgb(15,23,42)">
        <p>${this.escapeXml(section.title)}</p>
      </content>
    </shape>
    <line startX="64" startY="116" endX="896" endY="116">
      <border color="rgb(37,99,235)" width="3"/>
    </line>
    <shape type="rect" topLeftX="64" topLeftY="150" width="832" height="310">
      <fill>
        <fillColor color="rgb(255,255,255)"/>
      </fill>
      <border color="rgb(226,232,240)" width="1"/>
    </shape>
    <shape type="text" topLeftX="96" topLeftY="178" width="760" height="250">
      <content textType="body" fontSize="21" color="rgb(51,65,85)" lineSpacing="multiple:1.35">
        ${bodyXml}
      </content>
    </shape>
    <shape type="text" topLeftX="790" topLeftY="486" width="106" height="26">
      <content textType="caption" textAlign="right" fontSize="12" color="rgb(100,116,139)">
        <p>${index + 1}</p>
      </content>
    </shape>
  </data>
  ${noteXml}
</slide>`;
  }

  private bodyXml(body: string[]) {
    if (body.length === 0) {
      return "<p>暂无详细内容。</p>";
    }

    return `<ul>${body
      .map((item) => `<li><p>${this.escapeXml(item)}</p></li>`)
      .join("")}</ul>`;
  }

  private cleanText(value: string) {
    return value
      .replace(/^第\s*\d+\s*页[:：]\s*/, "")
      .replace(/^Slide\s*\d+[:：]\s*/i, "")
      .trim();
  }

  private escapeXml(value: string) {
    return value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }
}
