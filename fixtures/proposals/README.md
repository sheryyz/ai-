# Proposal fixtures

Hand-written proposals used by unit/API tests. They are **not** model output.
Recorded real model responses for offline demo mode live in `fixtures/recorded/` and carry model name and timestamp.

| 文件 | 基于 | 用途 |
|---|---|---|
| `event-checkin.patch.json` | 活动模板 v1 | 加签到、未签到提醒、签到率（AC-03） |
| `event-signup-page.patch.json` | 活动模板 v1 | 分享页「报名页」，只含表单（AC-15） |
| `event-desk.patch.json` | 签到演进后的 v2 | 分享页「签到台」，禁止接触手机号（AC-16 / 18） |
