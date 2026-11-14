/** Opt-in live smoke check. In-memory fixture only; never reads the user's business database.
 * node/tsx invocation must be explicitly authorized before using real model credentials. */
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createApp } from '../app'
import { loadEnvFile, parseConfig } from '../config'
import { createApp as createBusinessApp, getApp } from '../services/apps'
import { generateOptions, prepareIntent } from '../services/guidance'
import { getTemplate } from '../services/templates'

loadEnvFile()
const config = parseConfig({ ...process.env, DATABASE_PATH: ':memory:', NODE_ENV: 'test' })
const { ctx } = createApp(config)
const maxCalls = Number(process.argv.find((a) => a.startsWith('--max-calls='))?.split('=')[1] ?? 7)
if (!Number.isInteger(maxCalls) || maxCalls < 1 || maxCalls > 7) throw new Error('max-calls must be 1..7')
const live = ctx.llm
let calls = 0
if (live)
  ctx.llm = {
    ...live,
    chat: (messages, options) => {
      if (calls >= maxCalls) throw new Error('达到本次模型调用上限，停止验证')
      calls++
      return live.chat(messages, options)
    },
  }
try {
  const app = createBusinessApp(ctx, getTemplate('event-registration').info.definition, {
    source: 'template',
  })
  const prepared = await prepareIntent(ctx, {
    appId: app.id,
    intent:
      '优化这个报名管理页的信息呈现，让组织者更容易找到报名人数和报名名单。保留现有字段、所有组件、数据连接、统计口径和权限；只调整现有组件的标题、说明或排列，不新增分享页面，不改变业务记录。',
  })
  // A smoke check must not silently choose answers on a human's behalf.
  if (prepared.brief.questions.length) {
    console.log(
      JSON.stringify(
        {
          status: 'clarification-required',
          calls,
          questions: prepared.brief.questions,
          alternatives: prepared.brief.alternatives,
        },
        null,
        2,
      ),
    )
  } else {
    const result = await generateOptions(ctx, { briefId: prepared.id, answers: [], choice: 'compare' })
    const output = path.join(tmpdir(), `morphos-guidance-${Date.now()}.json`)
    writeFileSync(
      output,
      JSON.stringify(
        {
          note: '真实模型集成验收；测试程序选择比较候选，不代表真实用户批准；没有批准任何方案。',
          prepared,
          result,
        },
        null,
        2,
      ),
    )
    console.log(
      JSON.stringify(
        {
          status:
            result.proposals.length === 2 && result.proposals.every((p) => p.status === 'pending')
              ? 'passed'
              : 'failed',
          calls,
          proposals: result.proposals.map((p) => ({
            id: p.id,
            label: p.optionLabel,
            status: p.status,
            rounds: p.trace.rounds.length,
          })),
          failures: result.failures,
          unchangedVersion: getApp(ctx, app.id).version,
          tracePath: output,
        },
        null,
        2,
      ),
    )
  }
} finally {
  ctx.db.close()
}
