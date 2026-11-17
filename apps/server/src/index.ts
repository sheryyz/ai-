import { createApp } from './app'
import { assertNodeVersion, loadEnvFile, parseConfig } from './config'

assertNodeVersion()
loadEnvFile()
const config = parseConfig(process.env)
const { app } = createApp(config)

app.listen(config.port, () => {
  const ai = config.llm.apiKey ? `AI 实时 · ${config.llm.model}` : '离线模式（未配置 LLM_API_KEY）'
  console.log(`MorphOS server → http://localhost:${config.port}  [${ai}]`)
  if (config.adminAccess === 'any') {
    console.log('工作区注册与登录已开放；每个账号的数据独立。公网部署请使用 HTTPS。')
  }
})
