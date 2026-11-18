// Build the Prompt history snapshot (Word) from docs/prompts — the repository files are the source of truth.
//
//   DOCX_MODULES=<node_modules with docx> node docs/deliverables/prompt-snapshot/build_prompt_docx.cjs
//
// User prompts, assistant replies and user answers to AI questions are reproduced in full. Tool calls and
// tool outputs are shortened in Word only; every shortened item names its source line in exports/*.md.

const fs = require("fs");
const path = require("path");
const req = process.env.DOCX_MODULES ? require("module").createRequire(path.join(process.env.DOCX_MODULES, "_.js")) : require;
const {
  AlignmentType, BorderStyle, Document, Footer, Header, HeadingLevel, LineRuleType, Packer, PageBreak, PageNumber,
  Paragraph, ShadingType, Table, TableCell, TableOfContents, TableRow, TextRun, WidthType,
} = req("docx");

const ROOT = path.join(__dirname, "../../..");
const PROMPTS = path.join(ROOT, "docs/prompts");
const OUT = path.join(__dirname, "../MorphOS_Prompt历史快照.docx");
const BUILT = "2026-11-17";
const REPO = "https://github.com/sheryyz/ai-";

const TOOL_LINES = 14; // shortened tool items keep this many lines …
const TOOL_CHARS = 1200; // … and at most this many characters

// ---------------------------------------------------------------- type
const CM = 567;
const MARGIN = { top: 2.5 * CM, bottom: 2.4 * CM, left: 2.8 * CM, right: 2.6 * CM };
const TEXT_W = Math.round(21 * CM - MARGIN.left - MARGIN.right);
const SONG = { ascii: "Times New Roman", hAnsi: "Times New Roman", cs: "Times New Roman", eastAsia: "宋体" };
const HEI = { ascii: "Times New Roman", hAnsi: "Times New Roman", cs: "Times New Roman", eastAsia: "黑体" };
const MONO = { ascii: "Consolas", hAnsi: "Consolas", cs: "Consolas", eastAsia: "宋体" };
const PT = (p) => Math.round(p * 2);
const LINE = { line: 360, lineRule: LineRuleType.AUTO };
const SINGLE = { line: 240, lineRule: LineRuleType.AUTO };
const COLOR = { user: "1F4E79", assistant: "385723", tool: "595959", note: "7F6000" };

// inline markdown: **bold**, `code`, [text](link) → text
function runs(text, base = {}) {
  const out = [];
  const re = /\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\([^)]+\)/g;
  let last = 0;
  let m;
  const plain = (t, extra = {}) => t && out.push(new TextRun({ text: t, font: SONG, size: PT(12), ...base, ...extra }));
  while ((m = re.exec(text))) {
    plain(text.slice(last, m.index));
    if (m[1]) plain(m[1], { bold: true });
    else if (m[2]) out.push(new TextRun({ text: m[2], font: MONO, size: PT(10.5), ...base }));
    else plain(m[3]);
    last = re.lastIndex;
  }
  plain(text.slice(last));
  return out;
}

const para = (text, opts = {}) =>
  new Paragraph({ spacing: { ...LINE, after: 60 }, indent: opts.indent, alignment: AlignmentType.JUSTIFIED, children: runs(text, opts.run) });

const heading = (text, level) =>
  new Paragraph({
    heading: level,
    spacing: { before: level === HeadingLevel.HEADING_1 ? 360 : 200, after: 120 },
    pageBreakBefore: level === HeadingLevel.HEADING_1,
    children: [new TextRun({ text, font: HEI, bold: true, size: PT(level === HeadingLevel.HEADING_1 ? 16 : level === HeadingLevel.HEADING_2 ? 14 : 12) })],
  });

// monospace block; long lines wrap naturally in Word
function block(text, { fill = "F2F2F2", size = 9 } = {}) {
  const lines = text.replace(/\s+$/, "").split("\n");
  return new Paragraph({
    spacing: { ...SINGLE, before: 40, after: 120 },
    shading: { type: ShadingType.CLEAR, color: "auto", fill },
    border: { left: { style: BorderStyle.SINGLE, size: 12, color: "BFBFBF", space: 6 } },
    indent: { left: 120 },
    children: lines.flatMap((l, i) => [...(i ? [new TextRun({ break: 1 })] : []), new TextRun({ text: l || " ", font: MONO, size: PT(size) })]),
  });
}

function table(rows, widths) {
  const total = widths.reduce((a, b) => a + b, 0);
  const tw = widths.map((w) => Math.round((w / total) * TEXT_W));
  const line = { style: BorderStyle.SINGLE, size: 6, color: "808080" };
  return new Table({
    width: { size: TEXT_W, type: WidthType.DXA },
    columnWidths: tw,
    rows: rows.map(
      (r, ri) =>
        new TableRow({
          tableHeader: ri === 0,
          children: r.map(
            (c, ci) =>
              new TableCell({
                width: { size: tw[ci], type: WidthType.DXA },
                borders: { top: line, bottom: line, left: line, right: line },
                shading: ri === 0 ? { type: ShadingType.CLEAR, color: "auto", fill: "E7E6E6" } : undefined,
                margins: { top: 40, bottom: 40, left: 80, right: 80 },
                children: [new Paragraph({ spacing: SINGLE, children: runs(String(c), { size: PT(10), ...(ri === 0 ? { bold: true } : {}) }) })],
              }),
          ),
        }),
    ),
  });
}

// ---------------------------------------------------------------- markdown (summaries, index) → paragraphs
function markdown(md, { skipTitle = true } = {}) {
  const out = [];
  const lines = md.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^```/.test(l)) {
      const body = [];
      while (++i < lines.length && !/^```/.test(lines[i])) body.push(lines[i]);
      out.push(block(body.join("\n")));
    } else if (/^\|/.test(l)) {
      const rows = [];
      for (; i < lines.length && /^\|/.test(lines[i]); i++)
        if (!/^\|[\s:|-]+\|$/.test(lines[i])) rows.push(lines[i].replace(/^\||\|$/g, "").split("|").map((c) => c.trim()));
      i--;
      out.push(table(rows, rows[0].map(() => 1)), para(""));
    } else if (/^# /.test(l)) {
      if (!skipTitle) out.push(heading(l.slice(2), HeadingLevel.HEADING_2));
    } else if (/^#{2,4} /.test(l)) {
      out.push(new Paragraph({ spacing: { before: 160, after: 80 }, children: runs(l.replace(/^#+ /, ""), { font: HEI, bold: true }) }));
    } else if (/^> ?/.test(l)) {
      out.push(para(l.replace(/^> ?/, ""), { indent: { left: 420 }, run: { color: "404040", size: PT(10.5) } }));
    } else if (/^\s*[-*] /.test(l)) {
      out.push(para(`• ${l.replace(/^\s*[-*] /, "")}`, { indent: { left: 420, hanging: 210 } }));
    } else if (/^\d+\. /.test(l)) {
      out.push(para(l, { indent: { left: 420, hanging: 280 } }));
    } else if (l.trim()) {
      out.push(para(l, { indent: { firstLine: 480 } }));
    }
  }
  return out;
}

// ---------------------------------------------------------------- transcript parsing
function parseTranscript(md) {
  const items = [];
  const parts = md.split(/^## /m).slice(1);
  for (const p of parts) {
    const head = p.split("\n")[0];
    const fence = p.match(/````text\n([\s\S]*?)\n````/);
    const body = fence ? fence[1] : p.split("\n").slice(1).join("\n").trim();
    const m = head.match(/^源行 (\d+) · (\S+) · (.+)$/);
    if (m) items.push({ line: Number(m[1]), ts: m[2], role: m[3].trim(), body });
    else items.push({ line: Number((head.match(/\d+/) || [0])[0]), ts: "", role: "event", title: head, body });
  }
  return items;
}

const beijing = (ts) => {
  const d = new Date(new Date(ts).getTime() + 8 * 3600e3);
  return d.toISOString().replace("T", " ").slice(0, 19);
};

function shorten(text) {
  const lines = text.split("\n");
  let s = lines.slice(0, TOOL_LINES).join("\n");
  if (s.length > TOOL_CHARS) s = s.slice(0, TOOL_CHARS);
  return { text: s, cut: s.length < text.length };
}

// user answers to request_user_input come back as tool output carrying "answer"
function userAnswers(text) {
  const m = text.match(/\[\{"questionItemId[\s\S]*?\}\]/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]).map((a) => ({ q: a.question, a: a.answer }));
  } catch {
    return null;
  }
}

function label(text, color, extra = "") {
  return new Paragraph({
    spacing: { before: 200, after: 60 },
    keepNext: true,
    border: { bottom: { style: BorderStyle.SINGLE, size: 4, color, space: 2 } },
    children: [
      new TextRun({ text, font: HEI, bold: true, size: PT(11), color }),
      new TextRun({ text: extra, font: SONG, size: PT(9), color: "808080" }),
    ],
  });
}

function transcript(items, file, stats) {
  const out = [];
  for (const it of items) {
    const meta = `　源行 ${it.line}${it.ts ? ` · 北京时间 ${beijing(it.ts)}` : ""}`;
    if (it.role === "user" && userAnswers(it.body)) {
      stats.answers++;
      out.push(label("【用户选择】（回答 AI 的澄清问题）", COLOR.user, meta));
      for (const a of userAnswers(it.body)) {
        out.push(para(`问：${a.q}`, { run: { color: "595959", size: PT(10.5) } }));
        out.push(para(`答：${a.a}`, { run: { bold: true } }));
      }
    } else if (it.role === "user") {
      stats.user++;
      out.push(label("【用户 Prompt】", COLOR.user, meta));
      out.push(...it.body.split("\n").filter((l) => l.trim()).map((l) => para(l, { run: { color: "1F1F1F" } })));
    } else if (it.role === "assistant") {
      stats.assistant++;
      out.push(label("【AI 回复】", COLOR.assistant, meta));
      out.push(...markdown(it.body, { skipTitle: false }));
    } else if (it.role === "event") {
      out.push(label(`【${it.title.replace(/^源行 \d+：/, "")}】`, COLOR.note, `　源行 ${it.line}`));
      out.push(para(it.body.replace(/^\[|\]$/g, ""), { run: { color: COLOR.note } }));
    } else if (it.role === "工具输出" && userAnswers(it.body)) {
      stats.answers++;
      out.push(label("【用户选择】（回答 AI 的澄清问题）", COLOR.user, meta));
      for (const a of userAnswers(it.body)) {
        out.push(para(`问：${a.q}`, { run: { color: "595959", size: PT(10.5) } }));
        out.push(para(`答：${a.a}`, { run: { bold: true } }));
      }
    } else if (it.role.startsWith("工具调用 request_user_input")) {
      stats.tools++;
      out.push(label("【AI 提问（选项）】", COLOR.assistant, meta));
      let qs;
      try {
        qs = JSON.parse(it.body).questions;
      } catch {}
      if (qs) for (const q of qs) out.push(para(q.title), ...(q.options || []).map((o) => para(`○ ${o}`, { indent: { left: 420 } })));
      else out.push(block(it.body));
    } else {
      stats.tools++;
      const s = shorten(it.body);
      if (s.cut) stats.cut++;
      const kind = it.role.startsWith("工具调用") ? "工具调用" : "工具输出";
      out.push(label(`［${kind}］`, COLOR.tool, meta));
      out.push(block(s.text + (s.cut ? `\n…（Word 中已截短；全文见 docs/prompts/exports/${file} 源行 ${it.line}）` : ""), { size: 8 }));
    }
  }
  return out;
}

// ---------------------------------------------------------------- content
const manifest = JSON.parse(fs.readFileSync(path.join(PROMPTS, "exports/manifest.json"), "utf8"));
const CHAINS = [
  { n: "01", title: "意图控制五项功能", summary: "2026-11-14-01-intent-control.md", bug: "模型改动越界、类型与测试失败后修复", commit: "26f9ca9" },
  { n: "02", title: "管理员登录", summary: "2026-11-14-02-admin-login.md", bug: "Cookie 类型边界、fixture 类型导出、端口权限报错、深色截图核查", commit: "26f9ca9" },
  { n: "03", title: "真实模型评测、备份恢复、手机真机验收", summary: "2026-11-14-03-recovery-phone.md", bug: "首轮评测 3/6 → 修正判据与提示词 → 复测；用户真机反馈", commit: "26f9ca9、363833d" },
];
for (const c of CHAINS) {
  c.file = `${c.n}-source-transcript.md`;
  c.meta = manifest.exports.find((e) => e.file === c.file);
  c.items = parseTranscript(fs.readFileSync(path.join(PROMPTS, "exports", c.file), "utf8"));
}

const body = [];

// cover
body.push(
  new Paragraph({ spacing: { before: 3000, after: 400 }, alignment: AlignmentType.CENTER, children: [new TextRun({ text: "MorphOS", font: HEI, bold: true, size: PT(26) })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 300 }, children: [new TextRun({ text: "AI 对话 Prompt 历史快照", font: HEI, bold: true, size: PT(22) })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 1600 }, children: [new TextRun({ text: "三条核心功能迭代的完整 Prompt 链（对应比赛要求 2.1）", font: SONG, size: PT(14) })] }),
  ...[
    "全国高校 Vibe Coding 开发挑战赛 · 研究生组",
    `代码仓库：${REPO}`,
    `证据源：仓库 docs/prompts/exports/（原始日志区间导出，SHA-256 见 manifest.json）`,
    `生成日期：${BUILT}（由 docs/deliverables/prompt-snapshot/build_prompt_docx.cjs 从仓库文件生成）`,
  ].map((t) => new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 120 }, children: [new TextRun({ text: t, font: SONG, size: PT(12) })] })),
  new Paragraph({ children: [new PageBreak()] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 240 }, children: [new TextRun({ text: "目　录", font: HEI, bold: true, size: PT(16) })] }),
  new TableOfContents("目录", { hyperlink: true, headingStyleRange: "1-2" }),
);

// 1 说明
body.push(heading("一、阅读说明与完整性边界", HeadingLevel.HEADING_1));
body.push(
  ...markdown(
    [
      "本快照收录 MorphOS 开发过程中三条核心功能迭代与 AI 编程助手的交互记录。每条链都包含：**用户的 Prompt 提问 → AI 的方案与修改 → 开发中出现的错误或不合理判据 → 用户或测试结果引导 AI 修复 → 最终验证**。",
      "开发工具：Codex（命令行 AI 编程助手），具体模型版本未在日志中核实。时间均已换算为北京时间（原始日志为 UTC）。",
      "## 本文件中的内容如何对应原始记录",
      "- **用户 Prompt、AI 回复、AI 的澄清提问与用户的选择：完整收录，未删改。**",
      `- 工具调用（命令、代码编辑）与工具输出（测试结果、报错）：为控制篇幅，Word 中每项最多保留前 ${TOOL_LINES} 行 / ${TOOL_CHARS} 字符，并标注源行号；全文在仓库 \`docs/prompts/exports/\` 对应文件中可逐行核对。`,
      "- 每条链开头的“导读”是编者整理的摘要，用于快速理解；以其后的对话原文为准。",
      "## 不包含的内容",
      "- 系统/开发者指令、模型内部推理、计费与重复事件；图片附件未导出。",
      "- 链 01 在源行 1280 发生一次上下文压缩，原样标注，没有补写缺失的逐字内容。",
      "- 三条链对应的功能集中在提交 `26f9ca9` 中落地，本文如实关联，不拆写历史。",
      "## 脱敏",
      "凭据、邮箱、手机号、个人路径、分享令牌和局域网地址已在导出时作标记替换（例如 `[已移除：凭据类型]`、`/v/[分享令牌]`）。代码中出现的测试账号、测试密码和虚构业务数据属于测试上下文，不是真实凭据。",
    ].join("\n"),
  ),
);

// 2 overview
body.push(heading("二、三条 Prompt 链总览", HeadingLevel.HEADING_1));
const stats = {};
const chainBodies = CHAINS.map((c) => {
  const s = (stats[c.n] = { user: 0, assistant: 0, answers: 0, tools: 0, cut: 0 });
  return transcript(c.items, c.file, s);
});
body.push(
  table(
    [
      ["链", "功能", "原始日志区间", "用户 Prompt / 选择", "AI 回复", "出现的问题与修复", "落地提交"],
      ...CHAINS.map((c) => [
        c.n,
        c.title,
        `${c.meta.sourceLines[0]}–${c.meta.sourceLines[1]}`,
        `${stats[c.n].user} / ${stats[c.n].answers}`,
        String(stats[c.n].assistant),
        c.bug,
        c.commit,
      ]),
    ],
    [0.6, 2.2, 1.4, 1.3, 0.9, 3.2, 1.4],
  ),
  para(""),
  para("文件校验（SHA-256，可用 shasum -a 256 在仓库中复核）：", { run: { bold: true } }),
  table(
    [["文件", "SHA-256"], [manifest.sourceFile.replace(/^rollout-/, "源日志 rollout-"), manifest.sourceSha256], ...CHAINS.map((c) => [`exports/${c.file}`, c.meta.sha256])],
    [2.2, 3.8],
  ),
);

// 3-5 chains
const NUM = ["三", "四", "五"];
CHAINS.forEach((c, i) => {
  body.push(heading(`${NUM[i]}、链 ${c.n}：${c.title}`, HeadingLevel.HEADING_1));
  body.push(heading(`${i + 3}.1 导读（编者摘要）`, HeadingLevel.HEADING_2));
  body.push(...markdown(fs.readFileSync(path.join(PROMPTS, c.summary), "utf8")));
  body.push(heading(`${i + 3}.2 对话原文（源行 ${c.meta.sourceLines[0]}–${c.meta.sourceLines[1]}）`, HeadingLevel.HEADING_2));
  body.push(...chainBodies[i]);
});

// 6 gaps
body.push(heading("六、尚缺材料与复核方式", HeadingLevel.HEADING_1));
body.push(
  ...markdown(
    [
      "- 图片附件（截图）未随文本导出；如需补充，应使用真实附件并人工遮挡账号、二维码等信息，不制作替代图。",
      "- 本文是功能区间的导出，不是整场会话的完整备份。",
      "- 复核方法：在仓库中打开 `docs/prompts/exports/0N-source-transcript.md`，按本文标注的源行号查找对应条目；用 `shasum -a 256` 对照第二章的校验值。",
      "- 重新生成本文件：`DOCX_MODULES=<含 docx 的 node_modules> node docs/deliverables/prompt-snapshot/build_prompt_docx.cjs`。",
    ].join("\n"),
  ),
);

const doc = new Document({
  creator: "MorphOS",
  title: "MorphOS Prompt 历史快照",
  features: { updateFields: true },
  styles: { default: { document: { run: { font: SONG, size: PT(12) } } } },
  sections: [
    {
      properties: { page: { margin: MARGIN } },
      headers: { default: new Header({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "MorphOS · AI 对话 Prompt 历史快照", font: SONG, size: PT(9), color: "808080" })] })] }) },
      footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ children: [PageNumber.CURRENT], size: PT(9) })] })] }) },
      children: body,
    },
  ],
});

Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync(OUT, buf);
  console.log(OUT, `${(buf.length / 1024).toFixed(0)} KB`);
  for (const c of CHAINS) console.log(c.n, JSON.stringify(stats[c.n]));
});
