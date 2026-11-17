# 技术文档构建

产物：`../MorphOS_技术文档.docx`（Word，论文版式）与 `../MorphOS_技术文档_预览.pdf`（由 Word 导出，用于核对页数）。

| 文件 | 作用 |
|---|---|
| `content.cjs` | 正文内容（四章 + 总结）；数字只取自仓库中的测试、评测与 Git 记录 |
| `build_docx.cjs` | 版式：宋体/黑体 + Times New Roman，小四正文固定 20 磅行距，三线表，图表编号，页眉页码 |
| `figures.py` | 结构图与数据图（只用标准库）；图表数字在运行时读取 `eval/results/*.json`、`git log` 与源码行数 |
| `svg2png.mjs` | `figs/*.svg` → `figs-png/*.png`（3 倍） |
| `capture.mjs` | 在离线实例上沿场景 A 截取真实界面 → `shots/` |
| `img/` | 文档使用的截图（`shots/` 与 `test-results/` 中 E2E 截图经 `sips` 转为 JPEG） |

```bash
# 1. 截图（另开终端启动离线实例：PORT=8811 DATABASE_PATH=':memory:' LLM_API_KEY='' npm start）
node docs/deliverables/tech-doc/capture.mjs http://localhost:8811
cd docs/deliverables/tech-doc && for f in shots/*.png; do sips -s format jpeg -s formatOptions 85 -Z 2000 "$f" --out img/$(basename "$f" .png).jpg; done
# 2. 图表
python3 docs/deliverables/tech-doc/figures.py && node docs/deliverables/tech-doc/svg2png.mjs
# 3. Word（docx 与 image-size 是构建工具，不是项目依赖）
DOCX_MODULES=<含 docx、image-size 的 node_modules> node docs/deliverables/tech-doc/build_docx.cjs
```

打开 Word 时会询问是否更新域，选“是”以刷新目录页码。大赛要求不超过 30 页：当前 Word 导出为 29 页（封面 1 + 目录 1 + 正文 27），改动内容后请重新导出 PDF 核对页数。
