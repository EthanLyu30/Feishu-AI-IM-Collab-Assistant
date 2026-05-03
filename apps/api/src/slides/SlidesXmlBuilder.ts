interface SlideSection {
  title: string;
  body: string[];
  notes?: string;
}

type SlideKind = "cover" | "content" | "process" | "roles" | "timeline" | "summary";

export class SlidesXmlBuilder {
  build(markdown: string) {
    const sections = this.normalizeSections(this.parseSections(markdown)).slice(0, 8);
    const slides =
      sections.length > 0
        ? sections
        : [{ title: "Agent-Pilot 汇报", body: ["从 IM 对话到文档与演示稿的一键智能闭环"] }];

    return slides.map((section, index) => this.buildSlide(section, index, slides.length));
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
      body: section.body.map((item) => this.cleanText(item)).filter(Boolean).slice(0, 6),
      notes: section.notes ? this.cleanText(section.notes) : undefined
    }));
  }

  private normalizeSections(sections: SlideSection[]) {
    if (sections.length >= 5) return sections;

    const normalized = [...sections];
    const fallbackSections: SlideSection[] = [
      {
        title: "核心流程",
        body: ["IM 触发任务", "Agent 规划并请求确认", "自动生成 Docs 与 Slides", "群内回发交付链接"],
        notes: "用流程闭环证明 Agent 是主驾驶，而不是简单按钮集合。"
      },
      {
        title: "角色与权限边界",
        body: ["学生只维护自己的报名记录", "老师管理自己发布的活动", "管理员维护组织配置", "Agent 记录执行日志与交付版本"],
        notes: "强调权限边界和可审计性，让方案更像真实办公系统。"
      },
      {
        title: "交付计划",
        body: ["第一阶段跑通 IM 到 Docs / Slides", "第二阶段增强飞书内嵌页面", "第三阶段补充富媒体与归档", "最终形成可复用场景模块"],
        notes: "用阶段化路线说明可落地性和后续扩展空间。"
      }
    ];

    while (normalized.length < 5 && fallbackSections.length) {
      normalized.push(fallbackSections.shift()!);
    }
    return normalized;
  }

  private buildSlide(section: SlideSection, index: number, total: number) {
    const kind = this.getSlideKind(section, index, total);
    if (kind === "cover") return this.coverSlide(section);
    if (kind === "process") return this.processSlide(section, index, total);
    if (kind === "roles") return this.roleSlide(section, index, total);
    if (kind === "timeline") return this.timelineSlide(section, index, total);
    if (kind === "summary") return this.summarySlide(section, index, total);
    return this.contentSlide(section, index, total);
  }

  private getSlideKind(section: SlideSection, index: number, total: number): SlideKind {
    if (index === 0) return "cover";
    if (index === total - 1 || /总结|价值|交付|收尾|成果/.test(section.title)) return "summary";
    if (/流程|路径|步骤|闭环|链路/.test(section.title)) return "process";
    if (/角色|权限|用户|边界/.test(section.title)) return "roles";
    if (/计划|阶段|路线|下一步|里程碑/.test(section.title)) return "timeline";
    return "content";
  }

  private coverSlide(section: SlideSection) {
    const subtitle = this.compact(section.body[0] ?? "从 IM 对话到文档与演示稿的一键智能闭环", 42);
    return `<slide>
  <style><fill><fillColor color="rgb(9,30,58)"/></fill></style>
  <data>
    <shape type="rect" topLeftX="0" topLeftY="0" width="960" height="540">
      <fill><fillColor color="rgb(9,30,58)"/></fill>
    </shape>
    <shape type="rect" topLeftX="0" topLeftY="0" width="960" height="14">
      <fill><fillColor color="rgb(20,184,166)"/></fill>
    </shape>
    <shape type="rect" topLeftX="692" topLeftY="0" width="268" height="540">
      <fill><fillColor color="rgb(14,74,112)"/></fill>
    </shape>
    <shape type="text" topLeftX="76" topLeftY="88" width="420" height="30">
      <content textType="caption" fontSize="16" color="rgb(125,211,252)"><p>AGENT-PILOT / FEISHU IM COLLAB</p></content>
    </shape>
    <shape type="text" topLeftX="72" topLeftY="138" width="620" height="160">
      <content textType="title" fontSize="42" color="rgb(255,255,255)" lineSpacing="multiple:1.08">
        <p>${this.escapeXml(section.title)}</p>
      </content>
    </shape>
    <shape type="text" topLeftX="76" topLeftY="318" width="570" height="72">
      <content textType="sub-headline" fontSize="22" color="rgb(207,250,254)">
        <p>${this.escapeXml(subtitle)}</p>
      </content>
    </shape>
    <shape type="text" topLeftX="728" topLeftY="158" width="170" height="160">
      <content textType="headline" textAlign="center" fontSize="31" color="rgb(255,255,255)">
        <p>IM</p><p>Doc</p><p>Slides</p>
      </content>
    </shape>
    <shape type="text" topLeftX="722" topLeftY="348" width="188" height="46">
      <content textType="caption" textAlign="center" fontSize="15" color="rgb(186,230,253)">
        <p>自然语言驱动办公套件闭环</p>
      </content>
    </shape>
  </data>
  ${this.noteXml(section.notes)}
</slide>`;
  }

  private contentSlide(section: SlideSection, index: number, total: number) {
    const bodyXml = this.bulletTextXml(section.body.slice(0, 4), 104, 170);
    return `<slide>
  <style><fill><fillColor color="rgb(248,250,252)"/></fill></style>
  <data>
    ${this.headerXml(section, index, total)}
    <shape type="text" topLeftX="96" topLeftY="170" width="720" height="250">
      <content textType="body" fontSize="24" color="rgb(30,41,59)" lineSpacing="multiple:1.28">
        ${bodyXml}
      </content>
    </shape>
    <shape type="rect" topLeftX="92" topLeftY="436" width="330" height="4">
      <fill><fillColor color="rgb(251,191,36)"/></fill>
    </shape>
  </data>
  ${this.noteXml(section.notes)}
</slide>`;
  }

  private processSlide(section: SlideSection, index: number, total: number) {
    const steps = this.pad(section.body, ["IM 捕捉", "Agent 规划", "生成文档", "交付汇报"]).slice(0, 4);
    return `<slide>
  <style><fill><fillColor color="rgb(247,250,252)"/></fill></style>
  <data>
    ${this.headerXml(section, index, total)}
    ${steps.map((item, stepIndex) => this.processStepXml(item, stepIndex)).join("\n")}
    <line startX="166" startY="296" endX="790" endY="296"><border color="rgb(20,184,166)" width="3"/></line>
  </data>
  ${this.noteXml(section.notes)}
</slide>`;
  }

  private roleSlide(section: SlideSection, index: number, total: number) {
    const columns = this.roleColumns(section.body);
    return `<slide>
  <style><fill><fillColor color="rgb(250,250,249)"/></fill></style>
  <data>
    ${this.headerXml(section, index, total)}
    ${columns.map((column, columnIndex) => this.roleColumnXml(column.title, column.items, columnIndex)).join("\n")}
  </data>
  ${this.noteXml(section.notes)}
</slide>`;
  }

  private timelineSlide(section: SlideSection, index: number, total: number) {
    const phases = this.pad(section.body, ["第一阶段：跑通主链路", "第二阶段：增强飞书内嵌体验", "第三阶段：补充归档与富媒体"]).slice(0, 3);
    return `<slide>
  <style><fill><fillColor color="rgb(248,250,252)"/></fill></style>
  <data>
    ${this.headerXml(section, index, total)}
    ${phases.map((phase, phaseIndex) => this.phaseXml(phase, phaseIndex)).join("\n")}
  </data>
  ${this.noteXml(section.notes)}
</slide>`;
  }

  private summarySlide(section: SlideSection, index: number, total: number) {
    const headline = this.compact(section.body[0] ?? "Agent 完成从讨论到交付的闭环。", 36);
    const bodyXml = this.bulletTextXml(section.body.slice(1, 5), 120, 284);
    return `<slide>
  <style><fill><fillColor color="rgb(15,23,42)"/></fill></style>
  <data>
    <shape type="rect" topLeftX="0" topLeftY="0" width="960" height="540">
      <fill><fillColor color="rgb(15,23,42)"/></fill>
    </shape>
    <shape type="text" topLeftX="72" topLeftY="66" width="700" height="44">
      <content textType="caption" fontSize="15" color="rgb(251,191,36)"><p>FINAL DELIVERY</p></content>
    </shape>
    <shape type="text" topLeftX="72" topLeftY="126" width="760" height="116">
      <content textType="headline" fontSize="36" color="rgb(255,255,255)" lineSpacing="multiple:1.1">
        <p>${this.escapeXml(this.cleanText(section.title))}</p>
      </content>
    </shape>
    <shape type="text" topLeftX="76" topLeftY="244" width="730" height="48">
      <content textType="sub-headline" fontSize="23" color="rgb(204,251,241)">
        <p>${this.escapeXml(headline)}</p>
      </content>
    </shape>
    <shape type="text" topLeftX="92" topLeftY="330" width="700" height="120">
      <content textType="body" fontSize="21" color="rgb(226,232,240)" lineSpacing="multiple:1.25">
        ${bodyXml}
      </content>
    </shape>
    <shape type="rect" topLeftX="72" topLeftY="474" width="816" height="5">
      <fill><fillColor color="rgb(20,184,166)"/></fill>
    </shape>
    ${this.pageNumberXml(index, total, "rgb(148,163,184)")}
  </data>
  ${this.noteXml(section.notes)}
</slide>`;
  }

  private headerXml(section: SlideSection, index: number, total: number) {
    return `
    <shape type="rect" topLeftX="56" topLeftY="58" width="8" height="62">
      <fill><fillColor color="rgb(20,184,166)"/></fill>
    </shape>
    <shape type="text" topLeftX="82" topLeftY="50" width="700" height="78">
      <content textType="headline" fontSize="31" color="rgb(15,23,42)" lineSpacing="multiple:1.08">
        <p>${this.escapeXml(section.title)}</p>
      </content>
    </shape>
    <shape type="text" topLeftX="82" topLeftY="124" width="590" height="28">
      <content textType="caption" fontSize="14" color="rgb(100,116,139)">
        <p>Agent-Pilot 将 IM 讨论沉淀为可交付办公成果</p>
      </content>
    </shape>
    ${this.pageNumberXml(index, total, "rgb(100,116,139)")}`;
  }

  private processStepXml(item: string, index: number) {
    const x = 86 + index * 208;
    const colors = ["rgb(20,184,166)", "rgb(59,130,246)", "rgb(245,158,11)", "rgb(99,102,241)"];
    return `
    <shape type="rect" topLeftX="${x}" topLeftY="188" width="152" height="154">
      <fill><fillColor color="rgb(255,255,255)"/></fill>
      <border color="${colors[index]}" width="3"/>
    </shape>
    <shape type="text" topLeftX="${x + 18}" topLeftY="210" width="116" height="42">
      <content textType="headline" textAlign="center" fontSize="28" color="${colors[index]}"><p>0${index + 1}</p></content>
    </shape>
    <shape type="text" topLeftX="${x + 16}" topLeftY="264" width="120" height="58">
      <content textType="body" textAlign="center" fontSize="18" color="rgb(30,41,59)">
        <p>${this.escapeXml(this.compact(item, 18))}</p>
      </content>
    </shape>`;
  }

  private roleColumnXml(title: string, items: string[], index: number) {
    const x = 82 + index * 282;
    const colors = ["rgb(20,184,166)", "rgb(59,130,246)", "rgb(245,158,11)"];
    return `
    <shape type="text" topLeftX="${x}" topLeftY="178" width="220" height="36">
      <content textType="headline" fontSize="23" color="${colors[index]}"><p>${this.escapeXml(title)}</p></content>
    </shape>
    <shape type="rect" topLeftX="${x}" topLeftY="222" width="220" height="3">
      <fill><fillColor color="${colors[index]}"/></fill>
    </shape>
    <shape type="text" topLeftX="${x}" topLeftY="248" width="220" height="156">
      <content textType="body" fontSize="17" color="rgb(51,65,85)" lineSpacing="multiple:1.18">
        ${this.bulletTextXml(items.slice(0, 4), x, 248)}
      </content>
    </shape>`;
  }

  private phaseXml(phase: string, index: number) {
    const y = 176 + index * 92;
    const colors = ["rgb(20,184,166)", "rgb(59,130,246)", "rgb(245,158,11)"];
    return `
    <shape type="rect" topLeftX="92" topLeftY="${y}" width="52" height="52">
      <fill><fillColor color="${colors[index]}"/></fill>
    </shape>
    <shape type="text" topLeftX="106" topLeftY="${y + 11}" width="24" height="24">
      <content textType="headline" textAlign="center" fontSize="18" color="rgb(255,255,255)"><p>${index + 1}</p></content>
    </shape>
    <shape type="text" topLeftX="174" topLeftY="${y + 3}" width="650" height="54">
      <content textType="body" fontSize="22" color="rgb(30,41,59)">
        <p>${this.escapeXml(this.compact(phase, 42))}</p>
      </content>
    </shape>`;
  }

  private pageNumberXml(index: number, total: number, color: string) {
    return `<shape type="text" topLeftX="804" topLeftY="62" width="92" height="28">
      <content textType="caption" textAlign="right" fontSize="13" color="${color}">
        <p>${index + 1} / ${total}</p>
      </content>
    </shape>`;
  }

  private roleColumns(body: string[]) {
    const fallback = this.pad(body, ["查看活动、报名与取消", "发布活动、查看统计与导出名单", "配置规则、审计权限与归档"]);
    const student = fallback.filter((item) => /学生|报名|查看/.test(item));
    const teacher = fallback.filter((item) => /老师|教师|发布|导出|统计/.test(item));
    const admin = fallback.filter((item) => /管理员|Agent|权限|审计|归档|配置/.test(item));
    return [
      { title: "学生端", items: student.length ? student : [fallback[0]] },
      { title: "老师端", items: teacher.length ? teacher : [fallback[1] ?? fallback[0]] },
      { title: "治理与 Agent", items: admin.length ? admin : [fallback[2] ?? fallback[0]] }
    ];
  }

  private bulletTextXml(body: string[], _x: number, _y: number) {
    if (body.length === 0) {
      return "<p>暂无详细内容。</p>";
    }

    return `<ul>${body
      .map((item) => `<li><p>${this.escapeXml(this.compact(item, 46))}</p></li>`)
      .join("")}</ul>`;
  }

  private noteXml(notes: string | undefined) {
    return notes
      ? `<note><content textType="body"><p>${this.escapeXml(notes)}</p></content></note>`
      : "";
  }

  private pad(values: string[], fallback: string[]) {
    const merged = [...values];
    for (const item of fallback) {
      if (merged.length >= fallback.length) break;
      merged.push(item);
    }
    return merged;
  }

  private compact(value: string, maxLength: number) {
    const normalized = value.replace(/\s+/g, " ").trim();
    return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}…` : normalized;
  }

  private cleanText(value: string) {
    return value
      .replace(/^第\s*\d+\s*页[:：]\s*/, "")
      .replace(/^Slide\s*\d+[:：]\s*/i, "")
      .replace(/^[-*]\s+/, "")
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
