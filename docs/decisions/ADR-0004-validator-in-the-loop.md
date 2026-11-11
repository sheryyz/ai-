# ADR-0004 Validator-in-the-loop 自修复

- 状态：已采纳 · 2026-11-11

## 背景（真实观察）
立项当天用 DeepSeek（`deepseek-chat` 别名解析为 `deepseek-flash`）开启 `response_format: json_object` 做最小测试，第一次返回内容为 `{"ok":##}`——**JSON 模式下仍输出了不合法 JSON**。同一请求加上系统提示后重试两次均正常。结论：模型输出的合法性不能被假设。

## 决定
PlannerService 在 JSON 解析或 L1–L6 校验失败时，把结构化 `ValidationIssue[]`（含 code、path、hint）作为新一轮消息回馈模型，最多自修复 2 轮；每轮过程推送前端可见，并记入 `proposals.trace_json`。

## 后果
- ✅ 首轮失败不等于用户失败；评测中可分别统计“首轮通过率”与“修复后通过率”。
- ✅ hint 字段同时服务用户与模型，错误信息只维护一份。
- ❌ 失败时延迟增加。对策：轮数上限 + 超时 + 前端分步进度。
