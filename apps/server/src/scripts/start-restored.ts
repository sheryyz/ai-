import path from 'node:path'
import { loadEnvFile } from '../config'
import { inspectBackup, RECOVERY_ROOT } from '../services/backup'

const id = process.argv[2]
if (!id || !/^restore_[a-f0-9]{32}$/.test(id)) throw new Error('请使用工作区设置中生成的完整恢复命令')
const file = path.join(RECOVERY_ROOT, `${id}.db`)
inspectBackup(file)
loadEnvFile()
process.env.DATABASE_PATH = file
process.env.NODE_ENV = 'production'
await import('../index')
