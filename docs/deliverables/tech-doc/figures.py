"""Diagrams and charts for the MorphOS technical document.

    python3 docs/deliverables/tech-doc/figures.py      # → docs/deliverables/tech-doc/figs/*.svg
    node docs/deliverables/tech-doc/svg2png.mjs        # → figs-png/*.png for Word

Standard library only. Structural diagrams are hand-laid; every number in a chart is read from the
repository (eval/results/*.json, git log, source files) when the script runs, never typed in.
"""

from __future__ import annotations

import json
import re
import subprocess
from html import escape
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
OUT = HERE / "figs"

FONT = "'PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif"
MONO = "'SF Mono',Menlo,Consolas,monospace"
INK, INK2, MUTED, LINE, GRID = "#111111", "#4a4a48", "#8a8984", "#8f8e89", "#e4e3df"
MORPH, MORPH_BG, MORPH_BD = "#5b4ce0", "#eeecfd", "#b8b0f5"
BLUE, BLUE_BG, BLUE_BD = "#2a6fc9", "#e8f1fc", "#9ec5f4"
GREEN, GREEN_BG, GREEN_BD = "#16794a", "#e6f5ee", "#93d3b4"
AMBER, AMBER_BG, AMBER_BD = "#a45c00", "#fdf3e1", "#efc98a"
RED, RED_BG, RED_BD = "#c62f2f", "#fdeceb", "#f0a8a7"
GRAY_BG, GRAY_BD = "#f5f4f1", "#d6d5d0"


class D:
    def __init__(self, w: int, h: int) -> None:
        self.w, self.h, self.p = w, h, []

    def t(self, x, y, s, size=12, fill=INK, anchor="middle", weight=400, mono=False) -> None:
        fam = MONO if mono else FONT
        for i, line in enumerate(str(s).split("\n")):
            self.p.append(
                f'<text x="{x:.1f}" y="{y + i * (size + 5):.1f}" font-family="{fam}" font-size="{size}" fill="{fill}" '
                f'text-anchor="{anchor}" font-weight="{weight}" dominant-baseline="middle">{escape(line)}</text>'
            )

    def box(self, x, y, w, h, title=None, sub=None, fill=GRAY_BG, stroke=GRAY_BD, tfill=INK, size=13, sub_size=10.5,
            rx=8, dash=None, sw=1.2) -> None:
        d = f' stroke-dasharray="{dash}"' if dash else ""
        self.p.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" fill="{fill}" stroke="{stroke}" stroke-width="{sw}"{d}/>')
        if title is not None:
            tl = title.count("\n") + 1
            sl = sub.count("\n") + 1 if sub else 0
            block = tl * (size + 5) - 5 + (sl * (sub_size + 5) + 3 if sub else 0)
            top = y + h / 2 - block / 2 + size / 2
            self.t(x + w / 2, top, title, size=size, fill=tfill, weight=600)
            if sub:
                self.t(x + w / 2, top + (tl - 1) * (size + 5) + size / 2 + sub_size / 2 + 8, sub, size=sub_size, fill=INK2)

    def arrow(self, x1, y1, x2, y2, color=LINE, width=1.4, dash=None, head=True) -> None:
        d = f' stroke-dasharray="{dash}"' if dash else ""
        m = f' marker-end="url(#ah{color[1:]})"' if head else ""
        self._mk(color)
        self.p.append(f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{color}" stroke-width="{width}"{d}{m}/>')

    def path(self, d, color=LINE, width=1.4, dash=None, head=True) -> None:
        da = f' stroke-dasharray="{dash}"' if dash else ""
        m = f' marker-end="url(#ah{color[1:]})"' if head else ""
        self._mk(color)
        self.p.append(f'<path d="{d}" fill="none" stroke="{color}" stroke-width="{width}"{da}{m}/>')

    _marks: set[str] = set()

    def _mk(self, color: str) -> None:
        if not hasattr(self, "marks"):
            self.marks = set()
        self.marks.add(color)

    def rect(self, x, y, w, h, fill, rx=0, stroke="none", sw=1, opacity=1.0, dash=None) -> None:
        d = f' stroke-dasharray="{dash}"' if dash else ""
        self.p.append(f'<rect x="{x:.1f}" y="{y:.1f}" width="{w:.1f}" height="{h:.1f}" rx="{rx}" fill="{fill}" stroke="{stroke}" stroke-width="{sw}" opacity="{opacity}"{d}/>')

    def pill(self, x, y, s, fill, color, size=10.5, stroke="none") -> float:
        w = 14 + size * sum(0.6 if c.isascii() else 1.0 for c in s)
        self.p.append(f'<rect x="{x:.1f}" y="{y - 10}" width="{w:.1f}" height="20" rx="10" fill="{fill}" stroke="{stroke}"/>')
        self.t(x + w / 2, y, s, size=size, fill=color, weight=600)
        return w

    def save(self, name: str) -> None:
        OUT.mkdir(parents=True, exist_ok=True)
        marks = "".join(
            f'<marker id="ah{c[1:]}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">'
            f'<path d="M0,0 L10,5 L0,10 z" fill="{c}"/></marker>'
            for c in sorted(getattr(self, "marks", set()))
        )
        (OUT / f"{name}.svg").write_text(
            f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {self.w} {self.h}" width="{self.w}" height="{self.h}">'
            f"<defs>{marks}</defs>"
            f'<rect width="100%" height="100%" fill="#ffffff"/>\n' + "\n".join(self.p) + "\n</svg>\n",
            encoding="utf-8",
        )
        print(name)


# ---------------------------------------------------------------- 1 overview pipeline
def overview() -> None:
    d = D(900, 250)
    steps = [
        ("自然语言意图", "用户一句话", BLUE_BG, BLUE_BD),
        ("理解 · 规划", "组装上下文\n流式思考", MORPH_BG, MORPH_BD),
        ("生成提案", "create / patch\n/ refusal JSON", MORPH_BG, MORPH_BD),
        ("七层校验", "L1–L7\n纯函数", GREEN_BG, GREEN_BD),
        ("Morph Diff", "真实影响\n数据暴露", AMBER_BG, AMBER_BD),
        ("人工批准", "确认 / 拒绝\n/ 继续修改", BLUE_BG, BLUE_BD),
        ("新版本", "只追加\n可恢复", GRAY_BG, GRAY_BD),
    ]
    x, w, gap, y, h = 14, 110, 18, 60, 92
    for i, (a, b, f, s) in enumerate(steps):
        d.box(x, y, w, h, a, b, fill=f, stroke=s, size=13.5, sub_size=10.5)
        if i < len(steps) - 1:
            d.arrow(x + w + 2, y + h / 2, x + w + gap - 2, y + h / 2)
        x += w + gap
    # repair loop under validate
    vx = 14 + 3 * (w + gap)
    gx = 14 + 2 * (w + gap)
    d.path(f"M{vx + w / 2},{y + h} C{vx + w / 2},{y + h + 52} {gx + w / 2},{y + h + 52} {gx + w / 2},{y + h + 4}", color=RED, dash="5 4")
    d.t((vx + gx + w) / 2, y + h + 58, "不通过：ValidationIssue[] 回馈模型自修复（≤ 2 轮）", size=11, fill=RED)
    d.t(450, 26, "AI 只产出受约束的数据；系统校验并展示真实影响；人批准后才写入新版本", size=13.5, fill=INK2, weight=600)
    # data store
    d.box(700, y + h + 30, 186, 44, "业务记录", "与配置分离，提案无法改写", fill="#ffffff", stroke=GRAY_BD, size=11.5, sub_size=9.5)
    d.save("f-overview")


# ---------------------------------------------------------------- 2 dual-layer intent control
def dual_layer() -> None:
    d = D(900, 400)
    d.rect(10, 14, 880, 178, "#faf9ff", rx=10, stroke=MORPH_BD)
    d.rect(10, 208, 880, 178, "#f6fbf8", rx=10, stroke=GREEN_BD)
    d.t(30, 36, "第一层  开发侧：人 → AI 编码助手（Claude Code / Codex）", anchor="start", size=14, weight=600, fill=MORPH)
    d.t(30, 230, "第二层  产品侧：用户 → MorphOS 内的规划模型（DeepSeek，OpenAI 兼容）", anchor="start", size=14, weight=600, fill=GREEN)
    top = [
        ("意图载体", "需求 / 协议 / 架构\n设计 / 路线图 / ADR"),
        ("会话约束", "CLAUDE.md\n9 条硬约束"),
        ("执行节奏", "阶段验收标准\n小步提交 · 先测后报"),
        ("纠偏机制", "冲突先停 · 人决定\nADR 记录理由"),
        ("留痕", "Git 历史\nPrompt 导出 + 哈希"),
    ]
    bot = [
        ("意图载体", "自然语言 → Proposal\n（协议定义的 JSON）"),
        ("上下文约束", "注册表生成的提示词\n只发统计不发记录"),
        ("校验", "七层校验器\n自修复 ≤ 2 轮"),
        ("人在回路", "Morph Diff · 暴露确认\n澄清 · 双方案 · 持续约束"),
        ("留痕", "proposals.trace_json\n提示词版本号"),
    ]
    for row, items, y, f, s in ((0, top, 56, MORPH_BG, MORPH_BD), (1, bot, 250, GREEN_BG, GREEN_BD)):
        x = 30
        for i, (a, b) in enumerate(items):
            d.box(x, y, 152, 112, a, b, fill=f if i else "#ffffff", stroke=s, size=13, sub_size=11)
            if i < 4:
                d.arrow(x + 154, y + 56, x + 170, y + 56)
            x += 170
    d.t(450, 200, "同一原则贯穿两层：先把意图写成可检查的边界，再让 AI 在边界内生成；越界由程序拦截，取舍由人决定", size=11.5, fill=INK2)
    d.save("f-dual-layer")


# ---------------------------------------------------------------- 3 context stack
def context_stack() -> None:
    d = D(900, 380)
    layers = [
        ("CLAUDE.md", "每次会话自动加载：项目一句话、权威文档索引、9 条架构硬约束、工作方式、代码与 UI 规范、不要做清单", MORPH_BG, MORPH_BD),
        ("docs/roadmap.md", "每次会话先读：当前阶段、验收标准、上一阶段的验证记录与待办", BLUE_BG, BLUE_BD),
        ("docs/protocol.md", "改 packages/shared 前必读：AppDefinition、端口、DSL、Patch、七层校验、Diff、暴露计算", GREEN_BG, GREEN_BD),
        ("requirements · architecture · design", "功能取舍、模块与接口、视觉令牌与交互规范；新增文件/接口/UI 前读", AMBER_BG, AMBER_BD),
        ("docs/decisions/ADR-0001…0008", "想推翻既有设计时读：每条决定都写明背景（多为真实观察）、备选与代价", GRAY_BG, GRAY_BD),
    ]
    y = 20
    for i, (a, b, f, s) in enumerate(layers):
        inset = i * 18
        d.box(20 + inset, y, 600 - 2 * inset, 56, None, fill=f, stroke=s)
        d.t(36 + inset, y + 19, a, anchor="start", size=13.5, weight=600, mono=a.startswith(("CLAUDE", "docs")))
        d.t(36 + inset, y + 40, b, anchor="start", size=10.5, fill=INK2)
        y += 66
    d.box(660, 40, 220, 120, "AI 编码会话", "读取上述上下文 →\n复述目标与验收标准 →\n小块实现 → check / test", fill="#ffffff", stroke=MORPH, size=14, sub_size=11)
    d.box(660, 210, 220, 120, "冲突处理", "代码与协议不一致：\n先改文档并说明理由\n再改代码；设计冲突停下\n给推荐，等人决定", fill="#ffffff", stroke=RED_BD, size=14, sub_size=11)
    d.arrow(622, 100, 656, 100, color=MORPH)
    d.arrow(770, 162, 770, 206, color=RED, dash="4 3")
    d.save("f-context")


# ---------------------------------------------------------------- 4 prompt anatomy
def prompt_anatomy() -> None:
    d = D(900, 440)
    d.t(20, 18, "一次规划请求的消息结构（apps/server/src/llm/prompt.ts，PROMPT_VERSION = planner-v1.4）", anchor="start", size=12.5, weight=600, fill=INK2)
    # system
    d.box(20, 36, 420, 392, None, fill="#faf9ff", stroke=MORPH_BD)
    d.t(36, 56, "system：systemPrompt()", anchor="start", size=13.5, weight=600, fill=MORPH, mono=True)
    secs = [
        ("角色与总原则", "受约束 JSON 提案；保持不变的属性逐项保留", False),
        ("输出格式", "create / patch / refusal 三选一，只输出 JSON", False),
        ("硬性规则", "无删除记录、删字段、改类型；标识符正则", False),
        ("AppDefinition 结构", "实体 / 字段 / 节点 / 视图 / 绑定 + 数量上限", True),
        ("组件注册表", "由 REGISTRY 生成：端口类型、params 说明", True),
        ("筛选 DSL", "由 OPERATORS_BY_TYPE 生成：各类型操作符", True),
        ("PatchOp 白名单", "14 种允许的增量操作", False),
        ("创建 / 演进原则", "只做用户明确提出的；复用已有组件", False),
        ("分享页规则", "最少组件、只读表格、禁令写入 restrictedFields", False),
    ]
    y = 80
    for a, b, gen in secs:
        d.rect(34, y, 392, 32, "#ffffff", rx=6, stroke=GREEN if gen else GRAY_BD, sw=1.4 if gen else 1)
        d.t(46, y + 16, a, anchor="start", size=11.5, weight=600)
        d.t(178, y + 16, b, anchor="start", size=10, fill=INK2)
        y += 35
    d.rect(36, 404, 12, 8, "#ffffff", stroke=GREEN, sw=1.4)
    d.t(54, 408, "绿框：从共享代码生成，提示词不会与校验器脱节", anchor="start", size=10, fill=GREEN)
    # user task
    d.box(470, 36, 410, 150, None, fill="#f6fbf8", stroke=GREEN_BD)
    d.t(486, 56, "user：patchTaskMessage()", anchor="start", size=13.5, weight=600, fill=GREEN, mono=True)
    d.t(486, 84, "· baseVersion（L6 用来检测并发冲突）", anchor="start", size=11.5)
    d.t(486, 108, "· 当前 AppDefinition（压缩 JSON）", anchor="start", size=11.5)
    d.t(486, 132, "· 记录统计：条数、每字段已填数、枚举分布", anchor="start", size=11.5)
    d.t(486, 156, "  不含任何一条记录的内容", anchor="start", size=11.5, fill=RED)
    d.t(486, 176, "· 用户原话「…」与输出要求", anchor="start", size=11.5)
    # assistant / repair
    d.box(470, 204, 410, 80, None, fill="#ffffff", stroke=GRAY_BD)
    d.t(486, 224, "assistant：上一轮模型输出（原样）", anchor="start", size=13, weight=600, mono=False)
    d.t(486, 252, "仅在自修复时出现，供模型对照修改", anchor="start", size=11, fill=INK2)
    d.box(470, 300, 410, 106, None, fill=RED_BG, stroke=RED_BD)
    d.t(486, 320, "user：repairMessage(issues, round, 2)", anchor="start", size=13, weight=600, fill=RED, mono=True)
    d.t(486, 348, "[层] 错误码 @ 路径：中文说明", anchor="start", size=11.5)
    d.t(486, 370, "   建议：hint（与界面给用户的是同一份）", anchor="start", size=11.5)
    d.t(486, 392, "最多 12 条错误；要求重新输出完整提案", anchor="start", size=11, fill=INK2)
    d.arrow(675, 188, 675, 202)
    d.arrow(675, 286, 675, 298)
    d.save("f-prompt")


# ---------------------------------------------------------------- 5 repair loop / sequence
def repair_loop() -> None:
    d = D(900, 360)
    lanes = [("前端 Studio", 90), ("PlannerService", 300), ("模型", 520), ("shared 校验器", 740)]
    for name, x in lanes:
        d.box(x - 80, 14, 160, 34, name, fill=GRAY_BG, stroke=GRAY_BD, size=12.5)
        d.p.append(f'<line x1="{x}" y1="50" x2="{x}" y2="348" stroke="{GRID}" stroke-width="1.2" stroke-dasharray="3 3"/>')

    def msg(y, a, b, text, color=LINE, dash=None):
        xa, xb = dict(lanes)[a], dict(lanes)[b]
        d.arrow(xa, y, xb + (-4 if xb > xa else 4), y, color=color, dash=dash)
        d.t((xa + xb) / 2, y - 10, text, size=10.5, fill=color if color != LINE else INK2)

    msg(70, "前端 Studio", "PlannerService", "POST /api/ai/plan（NDJSON 流）")
    msg(98, "PlannerService", "前端 Studio", "stage: understand · 上下文摘要", dash="4 3")
    msg(126, "PlannerService", "模型", "system + task（JSON 模式，流式）")
    msg(154, "模型", "前端 Studio", "thinking 增量（reasoning_content）", dash="4 3")
    msg(182, "PlannerService", "shared 校验器", "JSON.parse → Zod → L2…L7 + 持续约束")
    msg(210, "shared 校验器", "PlannerService", "ValidationIssue[]（code · path · hint）", color=RED)
    d.rect(170, 222, 600, 56, RED_BG, rx=6, stroke=RED_BD, opacity=0.9)
    d.t(470, 238, "有错误且未到上限：issues 事件推送前端；repairMessage 回馈模型，进入下一轮", size=11, fill=RED)
    d.t(470, 260, "第 2 轮仍失败：提案记为 invalid，应用与记录不变，界面说明原因", size=11, fill=RED)
    msg(298, "PlannerService", "前端 Studio", "result：pending 提案 + Morph Diff", color=GREEN)
    msg(330, "前端 Studio", "PlannerService", "approve：事务内重新校验 + 版本检查 + 暴露确认", color=BLUE)
    d.save("f-repair")


# ---------------------------------------------------------------- 6 architecture
def architecture() -> None:
    d = D(900, 470)
    # web
    d.box(20, 14, 860, 110, None, fill=BLUE_BG, stroke=BLUE_BD)
    d.t(36, 32, "apps/web  ·  React 19 + Vite + Tailwind v4 + TanStack Query", anchor="start", size=13, weight=600, fill=BLUE)
    for i, (a, b) in enumerate([("应用中心 Hub", "一句话 / 模板 / 回放"), ("AI Studio", "对话·流水线 | 预览 | Diff·版本"),
                                ("管理页 Runtime", "按注册表渲染组件"), ("分享页 /v/:token", "只渲染服务端快照"), ("登录 · 设置", "单管理员 · 备份恢复")]):
        d.box(36 + i * 168, 50, 156, 60, a, b, fill="#ffffff", stroke=BLUE_BD, size=12, sub_size=10)
    d.arrow(450, 126, 450, 150, color=BLUE)
    d.t(462, 138, "REST + 流式 NDJSON（管理接口仅本机 + 登录会话；分享接口凭令牌）", size=10.5, fill=INK2, anchor="start")
    # server
    d.box(20, 152, 860, 150, None, fill=GREEN_BG, stroke=GREEN_BD)
    d.t(36, 170, "apps/server  ·  Express 5 + node:sqlite（副作用只在 services/ 与 db/）", anchor="start", size=13, weight=600, fill=GREEN)
    svcs = ["Planner\n规划流水线", "Proposal\n提案生命周期", "App\n版本只追加", "Record\n按 Schema 写入", "View\n令牌·快照裁剪",
            "Guidance\n澄清·双方案", "Constraint\n持续约束", "Backup\n备份·恢复"]
    for i, s in enumerate(svcs):
        a, b = s.split("\n")
        d.box(36 + i * 105, 186, 96, 54, a, b, fill="#ffffff", stroke=GREEN_BD, size=11.5, sub_size=9.5)
    d.box(36, 250, 200, 40, "llm/  客户端 · 提示词 · 回放", fill="#ffffff", stroke=GREEN_BD, size=11)
    d.box(246, 250, 200, 40, "access · auth  本机限制 · 会话", fill="#ffffff", stroke=GREEN_BD, size=11)
    d.box(456, 250, 200, 40, "db/  迁移 · 事务 · 参数化 SQL", fill="#ffffff", stroke=GREEN_BD, size=11)
    d.box(666, 250, 200, 40, "routes/  统一错误格式", fill="#ffffff", stroke=GREEN_BD, size=11)
    # shared
    d.box(20, 330, 860, 100, None, fill=MORPH_BG, stroke=MORPH_BD)
    d.t(36, 348, "packages/shared  ·  纯 TypeScript + Zod（无 IO、无 React、无 Node 内置模块；前后端共用同一实现）", anchor="start", size=13, weight=600, fill=MORPH)
    mods = ["schema", "registry", "validate", "patch", "diff", "exposure", "runtime", "constraints", "impact", "explain"]
    for i, m in enumerate(mods):
        d.box(36 + i * 84, 366, 78, 48, m, fill="#ffffff", stroke=MORPH_BD, size=10.5 if len(m) > 8 else 11.5)
        d.p[-1] = d.p[-1].replace(f"font-family=\"{FONT}\"", f"font-family=\"{MONO}\"")
    d.arrow(300, 304, 300, 326, color=MORPH)
    d.arrow(600, 304, 600, 326, color=MORPH)
    d.t(450, 452, "依赖方向只向下：web 与 server 只通过 shared 共享领域逻辑；外部模型只经 llm/ 进入，输出一律当作不可信数据", size=11, fill=INK2)
    # externals
    d.save("f-architecture")


# ---------------------------------------------------------------- 7 protocol model
def protocol_model() -> None:
    d = D(900, 380)
    d.box(20, 20, 250, 350, None, fill=GRAY_BG, stroke=GRAY_BD)
    d.t(36, 40, "AppDefinition（schemaVersion 1）", anchor="start", size=12.5, weight=600, mono=True)
    rows = [("name · icon · description", ""), ("entities[1]", "字段 ≤30 · 6 种类型\nsensitive 敏感标记"),
            ("nodes ≤32", "9 种组件 · region/order\nview 归属"), ("bindings ≤48", "类型化端口连线"), ("views ≤6", "label · audience\nrestrictedFields")]
    y = 56
    for a, b in rows:
        h = 34 if not b else (48 if "\n" not in b else 62)
        d.rect(32, y, 226, h, "#ffffff", rx=6, stroke=GRAY_BD)
        d.t(42, y + (17 if not b else 15), a, anchor="start", size=11.5, weight=600, mono=True)
        if b:
            d.t(42, y + 33, b, anchor="start", size=9.5, fill=INK2)
        y += h + 8
    # binding graph (scenario A after check-in)
    d.t(300, 30, "场景 A 演进后的数据流（节选，均为 AppDefinition 中的数据）", anchor="start", size=12.5, weight=600, fill=INK2)
    d.box(300, 160, 130, 54, "CollectionSource", "source.records", fill=GREEN_BG, stroke=GREEN_BD, size=11.5, sub_size=10)
    d.box(490, 60, 140, 46, "Filter", "计算机专业未签到", fill=BLUE_BG, stroke=BLUE_BD, size=11.5, sub_size=10)
    d.box(490, 250, 140, 46, "Filter · view=签到台", "未签到记录", fill=MORPH_BG, stroke=MORPH_BD, size=11, sub_size=10, dash="5 3")
    outs = [(690, 40, "MessageDraft", "签到提醒草稿", BLUE_BG, BLUE_BD, None), (690, 96, "Table", "报名名单", GRAY_BG, GRAY_BD, None),
            (690, 152, "Metric · ratio", "签到率", GRAY_BG, GRAY_BD, None), (690, 208, "Chart", "专业分布", GRAY_BG, GRAY_BD, None),
            (690, 268, "QuickAction", "签到登记（志愿者）", MORPH_BG, MORPH_BD, "5 3")]
    for x, y, a, b, f, s, dash in outs:
        d.box(x, y, 190, 44, a, b, fill=f, stroke=s, size=11.5, sub_size=10, dash=dash)
    d.arrow(432, 180, 488, 90, color=GREEN)
    d.arrow(432, 192, 488, 268, color=GREEN)
    d.arrow(632, 76, 688, 62, color=BLUE)
    for yy in (118, 174, 230):
        d.arrow(432, 187, 688, yy, color=GREEN)
    d.arrow(632, 278, 688, 290, color=MORPH)
    d.t(560, 356, "RecordSet<E> 只能接 RecordSet<E>；Number 不能接 RecordSet；必需输入恰好一条；不能成环（L3/L4）", size=10.5, fill=INK2)
    d.save("f-protocol")


# ---------------------------------------------------------------- 8 versions vs records
def versions() -> None:
    d = D(900, 340)
    d.t(20, 20, "app_versions（只追加的配置快照）", anchor="start", size=13, weight=600, fill=MORPH)
    vs = [("v1", "创建", GRAY_BG), ("v2", "报名页", GRAY_BG), ("v3", "签到", GRAY_BG), ("v4", "签到台", GRAY_BG), ("v5", "恢复 v1", AMBER_BG), ("v6", "恢复 v4", AMBER_BG)]
    for i, (v, s, f) in enumerate(vs):
        x = 20 + i * 140
        d.box(x, 56, 118, 58, v, s, fill=f, stroke=AMBER_BD if f == AMBER_BG else GRAY_BD, size=15, sub_size=11)
        if i < 5:
            d.arrow(x + 120, 85, x + 138, 85)
    d.path("M 859,56 C 840,24 560,24 501,52", color=AMBER, dash="4 3")
    d.t(680, 20, "restoredFrom = 4", size=10.5, fill=AMBER)
    d.path("M 719,114 C 640,162 120,162 79,118", color=AMBER, dash="4 3")
    d.t(400, 134, "restoredFrom = 1（恢复 = 新增一个内容等于旧版本的版本，历史不改写）", size=10.5, fill=AMBER)
    d.p.append(f'<line x1="20" y1="194" x2="880" y2="194" stroke="{INK}" stroke-width="1.5" stroke-dasharray="8 5"/>')
    d.rect(300, 174, 300, 22, "#ffffff")
    d.t(450, 184, "两表之间没有级联：恢复、批准提案都不触碰业务记录", size=11, fill=INK2)
    d.t(20, 220, "records（通用业务记录，JSON 列，软删除）", anchor="start", size=13, weight=600, fill=GREEN)
    cols = ["name", "studentId", "major", "phone", "checkedIn"]
    for j, c in enumerate(cols):
        d.rect(20 + j * 120, 236, 116, 26, GREEN_BG if c != "checkedIn" else "#ffffff", rx=4, stroke=GREEN_BD, dash="4 3" if c == "checkedIn" else None)
        d.t(78 + j * 120, 249, c, size=11, mono=True)
    for r, row in enumerate([["张三", "2024001", "计算机…", "138…01", "true"], ["李四", "2024002", "计算机…", "138…02", "（缺省）"]]):
        for j, c in enumerate(row):
            d.t(78 + j * 120, 280 + r * 24, c, size=11, fill=MUTED if c == "（缺省）" else INK)
    d.box(640, 232, 240, 96, "读取时虚拟填充", "新增字段不回写旧记录\n缺失键按 default ?? null 补齐\n旧版本未知的键原样保留", fill="#ffffff", stroke=GREEN_BD, size=12.5, sub_size=10.5)
    d.save("f-versions")


# ---------------------------------------------------------------- 9 exposure & share snapshot
def exposure() -> None:
    d = D(900, 330)
    d.box(20, 30, 170, 110, "AppDefinition", "签到台视图的组件\n+ 绑定 + 敏感标记\n+ restrictedFields", fill=GRAY_BG, stroke=GRAY_BD, size=12.5, sub_size=10.5)
    d.box(230, 30, 190, 110, "computeExposure()", "沿组件与绑定计算\nread / aggregate / write\n与记录范围", fill=MORPH_BG, stroke=MORPH_BD, size=12.5, sub_size=10.5)
    d.arrow(192, 85, 228, 85, color=MORPH)
    # three consumers
    cons = [("L7 校验", "受限字段 → 错误\n表格可编辑 → 错误\n敏感逐条可见 → 警告", RED_BG, RED_BD),
            ("Morph Diff 暴露栏", "改动前后对比\n高风险 → confirmExposure", AMBER_BG, AMBER_BD),
            ("服务端快照裁剪", "每个组件只下发其 read 字段\n统计组件只下发结果", GREEN_BG, GREEN_BD)]
    for i, (a, b, f, s) in enumerate(cons):
        y = 14 + i * 76
        d.box(470, y, 200, 64, a, b, fill=f, stroke=s, size=12, sub_size=9.8)
        d.arrow(422, 85, 468, y + 32, color=MORPH)
    d.t(325, 168, "同一纯函数，三处使用：\n校验、展示、执行不会各说各话", size=10.5, fill=INK2)
    # phone
    d.rect(720, 20, 160, 290, "#ffffff", rx=18, stroke=INK, sw=1.6)
    d.t(800, 44, "/v/:token  签到台", size=11.5, weight=600)
    for k, name in enumerate(["孙七", "周八", "赵六", "李四"]):
        d.rect(734, 66 + k * 40, 132, 32, GRAY_BG, rx=6)
        d.t(746, 82 + k * 40, name, anchor="start", size=11)
        d.rect(812, 72 + k * 40, 46, 20, INK, rx=5)
        d.t(835, 82 + k * 40, "签到", size=9.5, fill="#ffffff")
    d.t(800, 248, "响应 JSON 中查不到", size=10, fill=RED)
    d.t(800, 264, "手机号与学号的值", size=10, fill=RED)
    d.t(800, 290, "AC-16 接口测试守护", size=9.5, fill=MUTED)
    d.arrow(672, 198, 718, 198, color=GREEN)
    # bottom: request path
    d.box(20, 240, 400, 72, None, fill="#ffffff", stroke=GRAY_BD)
    d.t(36, 258, "持链接写入：POST /api/v/:token/actions/:nodeId", anchor="start", size=11.5, weight=600, mono=True)
    d.t(36, 280, "服务端检查组件属于该视图且未隐藏；只按 QuickAction 的 set/ask 改", anchor="start", size=10.5, fill=INK2)
    d.t(36, 298, "其输入范围内的记录；其余管理接口对非本机来源返回 403", anchor="start", size=10.5, fill=INK2)
    d.save("f-exposure")


# ---------------------------------------------------------------- 10 reproducibility layers
def repro() -> None:
    d = D(900, 330)
    cols = [
        ("环境复现", "评委能在 10 分钟内跑起来", BLUE_BG, BLUE_BD,
         ["Node ≥ 22.13 + npm，无需 Docker / pnpm", "node:sqlite 内置，无原生编译", "依赖版本锁定（package-lock）", ".env.example，模型 Key 可选", "启动时检查 Node 版本"]),
        ("行为复现", "同样输入得到同样结果", GREEN_BG, GREEN_BD,
         ["真实模型响应录制 → 离线回放", "回放时经当前校验器重新校验", "内存数据库 + 固定虚构数据", "APP_TIMEZONE 固定业务时区", "200 条单元/接口 + 7 条 E2E"]),
        ("过程复现", "从意图到代码的路径可追溯", MORPH_BG, MORPH_BD,
         ["110 次提交，文档先于代码", "roadmap 逐阶段写验证方式", "8 条 ADR 记录取舍与真实观察", "Prompt 原始区间导出 + SHA-256", "提示词版本写入每条 trace"]),
    ]
    for i, (a, b, f, s, items) in enumerate(cols):
        x = 20 + i * 293
        d.box(x, 14, 274, 66, a, b, fill=f, stroke=s, size=15, sub_size=11)
        for k, it in enumerate(items):
            d.rect(x, 92 + k * 44, 274, 36, "#ffffff", rx=6, stroke=s)
            d.t(x + 14, 110 + k * 44, it, anchor="start", size=11.2)
    d.t(450, 318, "三层分别回答：能不能跑、跑出来是不是同一个东西、它是怎么被做出来的", size=11.5, fill=INK2)
    d.save("f-repro")


# ---------------------------------------------------------------- charts
PHASES = [  # (label, last commit of the phase in `git log --reverse`)
    ("0 文档与骨架", "9350800"), ("1 协议实现", "8d0b0ed"), ("2 数据与运行时", "7b616cb"), ("3 AI 规划器", "c6fad7f"),
    ("4 Studio 与版本", "16311b2"), ("5 评测·场景B·打磨", "8463310"), ("6 E2E 与复现", "cde6a28"), ("R0 视图方案文档", "27ab0b4"),
    ("R1 暴露计算", "1b39077"), ("R2 服务端裁剪", "da0999a"), ("R3 分享页界面", "ff7b11b"), ("R4 提示词 v1.2·证据", "6c161f3"),
    ("P1 数据流图·建议", "9835ade"), ("受控演进·登录·恢复", "363833d"),
]
TYPES = [("feat", MORPH), ("fix", RED), ("test", GREEN), ("docs", BLUE), ("refactor/chore/style", MUTED)]


def git_commits() -> list[tuple[str, str]]:
    out = subprocess.run(["git", "log", "--reverse", "--format=%h %s"], cwd=ROOT, capture_output=True, text=True, check=True).stdout
    return [tuple(line.split(" ", 1)) for line in out.strip().splitlines()]  # type: ignore[misc]


def commit_type(subject: str) -> str:
    t = re.match(r"^([a-z]+)", subject)
    t = t.group(1) if t else "chore"
    return t if t in ("feat", "fix", "test", "docs") else "refactor/chore/style"


def commits_chart() -> None:
    commits = git_commits()
    buckets: list[dict[str, int]] = []
    i = 0
    for _, last in PHASES:
        b: dict[str, int] = {k: 0 for k, _ in TYPES}
        while i < len(commits):
            h, s = commits[i]
            b[commit_type(s)] += 1
            i += 1
            if last.startswith(h) or h.startswith(last):
                break
        buckets.append(b)
    assert i == len(commits), "phase boundaries do not cover the whole history"
    d = D(900, 430)
    left, top, rowh = 170, 50, 25
    mx = max(sum(b.values()) for b in buckets)
    scale = 600 / mx
    d.t(20, 18, f"按开发阶段统计的提交（共 {len(commits)} 次，git log 实时读取）", anchor="start", size=12.5, weight=600, fill=INK2)
    lx = 470
    for name, color in TYPES:
        d.rect(lx, 12, 12, 12, color, rx=2)
        d.t(lx + 16, 18, name, anchor="start", size=10.5, fill=INK2)
        lx += 34 + 7 * len(name)
    for k, ((label, _), b) in enumerate(zip(PHASES, buckets)):
        y = top + k * rowh
        d.t(left - 10, y + 9, label, anchor="end", size=11)
        x = left
        for name, color in TYPES:
            n = b[name]
            if n:
                d.rect(x, y, n * scale - 1, 18, color, rx=2, opacity=0.9)
                if n * scale > 16:
                    d.t(x + n * scale / 2, y + 9, str(n), size=9.5, fill="#ffffff", weight=600)
                x += n * scale
        d.t(x + 6, y + 9, str(sum(b.values())), anchor="start", size=10.5, fill=INK2, weight=600)
    d.p.append(f'<line x1="{left}" y1="{top - 6}" x2="{left}" y2="{top + len(PHASES) * rowh}" stroke="{INK2}" stroke-width="1"/>')
    d.t(450, 420, "最后一行是 2026-11-14 的两个集中提交（代码 26f9ca9 + 文档 363833d），未拆分为功能粒度，如实列出", size=10.5, fill=MUTED)
    d.save("c-commits")
    # also report type totals for the text
    tot = {k: sum(b[k] for b in buckets) for k, _ in TYPES}
    (OUT / "commits.json").write_text(json.dumps({"total": len(commits), "types": tot, "phases": [[p[0], sum(b.values())] for p, b in zip(PHASES, buckets)]}, ensure_ascii=False))


def count_lines(paths: list[Path]) -> int:
    return sum(len(p.read_text(encoding="utf-8").splitlines()) for p in paths)


def code_chart() -> None:
    pk = [("packages/shared", ROOT / "packages/shared/src"), ("apps/server", ROOT / "apps/server/src"), ("apps/web", ROOT / "apps/web/src"), ("tests/e2e", ROOT / "tests/e2e")]
    data = []
    for name, p in pk:
        files = [f for f in p.rglob("*") if f.suffix in (".ts", ".tsx")]
        test = [f for f in files if ".test." in f.name or ".spec." in f.name]
        src = [f for f in files if f not in test]
        data.append((name, count_lines(src), count_lines(test), len(test)))
    d = D(900, 250)
    d.t(20, 18, "TypeScript 代码行数：实现 vs 测试（含空行与注释，脚本实时统计）", anchor="start", size=12.5, weight=600, fill=INK2)
    left, top = 150, 50
    mx = max(a + b for _, a, b, _ in data)
    sc = 600 / mx
    for k, (name, a, b, nf) in enumerate(data):
        y = top + k * 44
        d.t(left - 10, y + 12, name, anchor="end", size=11.5, mono=True)
        d.rect(left, y, a * sc, 24, MORPH, rx=2, opacity=0.85)
        if a:
            d.t(left + a * sc / 2, y + 12, f"实现 {a:,}", size=10, fill="#ffffff", weight=600)
        d.rect(left + a * sc, y, b * sc, 24, GREEN, rx=2, opacity=0.85)
        if b:
            d.t(left + a * sc + b * sc / 2, y + 12, f"测试 {b:,}", size=10, fill="#ffffff", weight=600)
        d.t(left + (a + b) * sc + 8, y + 12, f"{nf} 个测试文件" if nf else "（界面行为由 E2E 覆盖）", anchor="start", size=10, fill=INK2)
    d.t(450, 236, "shared 是纯函数层，测试密度最高；web 不含领域逻辑，靠 7 条浏览器 E2E 检验", size=10.5, fill=MUTED)
    d.save("c-code")
    (OUT / "code.json").write_text(json.dumps(data, ensure_ascii=False))


def ab_chart() -> None:
    res = json.loads((ROOT / "eval/results/2026-11-12-deepseek-flash.json").read_text(encoding="utf-8"))
    runs = [r for r in res["runs"] if r["group"] == "evolve"]
    cases = sorted({r["caseId"] for r in runs})
    by = {(r["caseId"], r["strategy"]): r for r in runs}
    d = D(900, 370)
    d.t(20, 18, "演进类 10 条用例的单次规划耗时：A 整体重生成 vs B 增量 Patch（deepseek-flash · planner-v1.1 · 每例各 1 次）", anchor="start", size=12, weight=600, fill=INK2)
    left, top, bw = 70, 50, 34
    mx = max(r["totalMs"] for r in runs) / 1000
    mx = (int(mx) // 2 + 1) * 2
    ph = 230
    for g in range(0, mx + 1, 2):
        y = top + ph - g / mx * ph
        d.p.append(f'<line x1="{left}" y1="{y:.1f}" x2="880" y2="{y:.1f}" stroke="{GRID}" stroke-width="1"/>')
        d.t(left - 8, y, f"{g} s", anchor="end", size=10, fill=MUTED)
    for k, c in enumerate(cases):
        x = left + 12 + k * 80
        for j, (s, color) in enumerate((("A", AMBER), ("B", MORPH))):
            r = by.get((c, s))
            if not r:
                continue
            v = r["totalMs"] / 1000
            h = v / mx * ph
            d.rect(x + j * (bw + 2), top + ph - h, bw, h, color, rx=2, opacity=0.88)
            d.t(x + j * (bw + 2) + bw / 2, top + ph - h - 8, f"{v:.1f}", size=9, fill=INK2)
            if r["rounds"] > 1:
                d.t(x + j * (bw + 2) + bw / 2, top + ph - h - 20, f"{r['rounds']}轮", size=9, fill=RED, weight=600)
        d.t(x + bw + 1, top + ph + 14, c, size=10.5, mono=True)
    d.rect(640, 326, 12, 12, AMBER, rx=2)
    d.t(656, 332, "A 整体重生成（基线）", anchor="start", size=10.5)
    d.rect(640, 346, 12, 12, MORPH, rx=2)
    d.t(656, 352, "B 增量 Patch（本作品）", anchor="start", size=10.5)
    d.t(70, 332, "数据：eval/results/2026-11-12-deepseek-flash.json；“2轮”表示经过一次自修复。", anchor="start", size=10, fill=MUTED)
    d.t(70, 352, "单次运行存在随机波动，只说明这一轮实验，不构成统计显著性结论。", anchor="start", size=10, fill=MUTED)
    d.save("c-ab")


def views_chart() -> None:
    res = json.loads((ROOT / "eval/results/2026-11-12-deepseek-flash-views.json").read_text(encoding="utf-8"))
    runs = res["runs"]
    d = D(900, 270)
    d.t(20, 18, "角色视图评测 8 条用例逐条结果（deepseek-flash · planner-v1.2 · 暴露由 computeExposure 计算）", anchor="start", size=12, weight=600, fill=INK2)
    left, top, cw = 210, 70, 80
    metrics = ["结果符合预期", "首轮通过", "暴露期望全部成立", "禁令守住"]
    keys = []
    for k, m in enumerate(metrics):
        d.t(left - 12, top + k * 40 + 14, m, anchor="end", size=11.5)
    for j, r in enumerate(runs):
        cid = r.get("caseId", f"v0{j + 1}")
        d.t(left + j * cw + cw / 2, top - 18, cid, size=11, mono=True, weight=600)
        chk = r["check"]
        vals = [r["allowedOutcome"], r["rounds"] == 1, chk["correct"], chk["forbidHeld"]]
        keys.append(vals)
        for k, v in enumerate(vals):
            x, y = left + j * cw + 10, top + k * 40
            if v is None:
                d.rect(x, y, cw - 20, 28, "#ffffff", rx=5, stroke=GRAY_BD, dash="3 3")
                d.t(x + (cw - 20) / 2, y + 14, "不适用", size=9.5, fill=MUTED)
            else:
                d.rect(x, y, cw - 20, 28, GREEN_BG if v else AMBER_BG, rx=5, stroke=GREEN_BD if v else AMBER_BD)
                d.t(x + (cw - 20) / 2, y + 14, "✓" if v else f"{r.get('rounds')} 轮", size=12 if v else 10.5, fill=GREEN if v else AMBER, weight=600)
    d.t(450, 250, "数据：eval/results/2026-11-12-deepseek-flash-views.json。v04–v08 为演示以外领域；每例 1 次，样本小。", size=10.5, fill=MUTED)
    d.save("c-views")
    (OUT / "views.json").write_text(json.dumps(keys))


def main() -> None:
    overview()
    dual_layer()
    context_stack()
    prompt_anatomy()
    repair_loop()
    architecture()
    protocol_model()
    versions()
    exposure()
    repro()
    commits_chart()
    code_chart()
    ab_chart()
    views_chart()


if __name__ == "__main__":
    main()
