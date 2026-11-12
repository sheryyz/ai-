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
    console.warn('⚠ ADMIN_ACCESS=any：管理接口对所有来源开放，只应在自带鉴权的部署中使用（ADR-0008）')
  }
})
