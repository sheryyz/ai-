# 角色视图评测结果

> 由 `npm run eval:views -w @morphos/server` 生成，所有数字均来自本次实际运行。用例与指标定义见 [eval/README.md](../README.md)。
> 每个分享页能看到 / 修改什么由 `computeExposure` 在结果定义上计算，不采信模型的描述。

| 项目 | 值 |
|---|---|
| 模型 | deepseek-flash（api.deepseek.com） |
| 提示词版本 | planner-v1.2 |
| 温度 | 0.2 |
| 自修复上限 | 2 轮 |
| 日期 | 2026-11-12（Asia/Shanghai） |
| 代码版本 | e1abb2e |
| 运行次数 | 8（并发 4，总耗时 20.4 s） |

## 汇总（8 条用例，其中演示以外领域 5 条）

| 指标 | 值 |
|---|---|
| 结果符合预期（得到可批准的提案；越界用例允许拒绝） | 8/8（100%） |
| 首轮通过 | 6/8（75%） |
| 暴露正确率（结果符合预期且全部暴露期望成立） | 8/8（100%） |
| 禁令守住率（被禁止的字段没有进入该分享页） | 5/5（100%） |
| 禁令写入约束（被禁止的字段记入 restrictedFields） | 5/5（100%） |
| 是否需要公开确认判断正确 | 3/3（100%） |
| 延迟 P50 / P95 | 4.8 s / 14.9 s |
| 平均 token / 次 | 5,918 |

## 逐条结果

| 用例 | 起点 | 结果 | 轮数 | 耗时 | 逐条可见 | 可写 | 禁止接触 | 公开确认 | 未满足的期望 | 摘要 / 错误 |
|---|---|---|---|---|---|---|---|---|---|---|
| v01 | event-registration | pending | 1 | 4.6 s | — | name、studentId、major | — | 不需要 | ✓ | 新增“同学报名页”分享页，并在该页放入一个报名表单组件 |
| v02 | event-registration | pending | 1 | 6.5 s | name、major、checkedIn | checkedIn | phone | 不需要 | ✓ | 新增“已签到”字段，创建面向志愿者的签到台分享页（隐藏手机号、仅按姓名搜索标记签到），并在管理名单中显示签到状态 |
| v03 | event-registration | pending | 1 | 5.4 s | name、major、checkedIn、createdAt | checkedIn | phone | 不需要 | ✓ | 在「签到台」分享页新增一个导出组件，把全部报名记录导出为 CSV，列只含姓名、专业、签到状态与报名时间（不含被限制的手机号和需额外确认的学号 |
| v04 | club-supplies | pending | 1 | 4.3 s | — | item、quantity、applicant、phone、purpose | — | 不需要 | ✓ | 新增一个面向社团成员的分享页“申领页”，仅包含申领提交表单，不含任何记录列表 |
| v05 | club-supplies | pending | 1 | 4.8 s | item、quantity、applicant、status、purpose、createdAt | status | phone | 不需要 | ✓ | 新增“发放台”分享页：筛选已通过的申领，提供按物品名称搜索并标记已发放的快捷操作和只读列表，并隐藏手机号字段 |
| v06 | club-supplies | pending | 1 | 3.4 s | applicant、phone | — | — | 需要 | ✓ | 新增「电话通知」分享页，含一个筛选“状态=已通过”的筛选节点和一张只显示申领人、手机号的只读表格 |
| v07 | contest-scoring | pending | 2 | 14.9 s | title、track、score、comment | score、comment | team、leaderPhone | 不需要 | ✓ | 新增“评委打分”分享页，内含只读作品列表（仅作品名称、赛道、分数、评语）和可填写分数与评语的打分快捷操作，并限制评委看到队伍名称与队长手机号 |
| v08 | book-drift | pending | 2 | 5.5 s | title、author | — | ownerContact | 不需要 | ✓ | 新增“志愿者书架”分享页：筛选在架图书，显示在架数量与书名/作者只读列表，并限制书主人联系方式 |

## 用例原文

- **v01**（event-registration）给报名的同学一个报名页，填完表就行。
- **v02**（event-registration）活动现场要给门口志愿者一个签到台：只能按姓名搜索并标记签到，别让他们看到手机号。
- **v03**（event-registration）让志愿者也能导出完整名单。
- **v04**（club-supplies）给社团成员一个申领页，只能提交申领，看不到别人的申领。
- **v05**（club-supplies）给物资管理员一个发放台：按物品名称搜索已通过的申领并标记为已发放，别让他们看到申领人的手机号。
- **v06**（club-supplies）给负责电话通知的同学一个页面，列出已通过申领的申领人和手机号。
- **v07**（contest-scoring）给评委一个打分页：只能看到作品名称和赛道，可以填写分数和评语，看不到队伍名称和队长手机号。　校验问题：第 1 轮 schema:SCHEMA_INVALID；第 2 轮 无
- **v08**（book-drift）给图书角志愿者一个页面，展示在架的书名和作者，并显示目前在架的数量，不要显示书主人的联系方式。　校验问题：第 1 轮 graph:GRAPH_INPUT_UNBOUND；第 2 轮 无
