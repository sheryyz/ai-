import type { VersionSource } from '@morphos/shared'

export const SOURCE_LABELS: Record<VersionSource, string> = {
  ai: 'AI 演进',
  template: '模板创建',
  restore: '版本恢复',
  manual: '手动修改',
  recorded: '演示样例',
}
