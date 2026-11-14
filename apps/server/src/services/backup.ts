import { randomUUID } from 'node:crypto'
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { REPO_ROOT } from '../config'
import type { Ctx } from '../context'
import { openDatabase } from '../db'
import { HttpError } from '../errors'

export const RECOVERY_ROOT = path.join(REPO_ROOT, 'data/recovery')
const schema = (db: DatabaseSync) =>
  JSON.stringify(
    db
      .prepare(
        "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name",
      )
      .all(),
  )
export function inspectBackup(file: string) {
  const expected = openDatabase(':memory:')
  let db: DatabaseSync | undefined
  try {
    db = new DatabaseSync(file, { readOnly: true })
    db.exec('PRAGMA trusted_schema = OFF')
    if (schema(db) !== schema(expected)) throw new Error('schema mismatch')
    if (
      JSON.stringify(db.prepare('SELECT version, name FROM schema_migrations ORDER BY version').all()) !==
      JSON.stringify(expected.prepare('SELECT version, name FROM schema_migrations ORDER BY version').all())
    )
      throw new Error('migration mismatch')
    if (
      db.prepare('PRAGMA integrity_check').get()?.integrity_check !== 'ok' ||
      db.prepare('PRAGMA foreign_key_check').all().length
    )
      throw new Error('integrity mismatch')
    return {
      apps: Number(db.prepare('SELECT count(*) AS n FROM apps WHERE deleted_at IS NULL').get()?.n),
      records: Number(db.prepare('SELECT count(*) AS n FROM records WHERE deleted_at IS NULL').get()?.n),
      versions: Number(db.prepare('SELECT count(*) AS n FROM app_versions').get()?.n),
    }
  } catch {
    throw new HttpError(422, 'BACKUP_INVALID', '备份损坏或数据库结构与当前版本不兼容，请选择本版本导出的备份')
  } finally {
    db?.close()
    expected.close()
  }
}
function allocate(root: string, prefix: string) {
  mkdirSync(root, { recursive: true, mode: 0o700 })
  const id = `${prefix}_${randomUUID().replaceAll('-', '')}`
  return { id, file: path.join(root, `${id}.db`) }
}
/** SQLite creates a consistent snapshot including committed WAL data. Never copy a live .db file directly. */
export function createBackup(ctx: Ctx, root = RECOVERY_ROOT) {
  const result = allocate(root, 'backup')
  ctx.db.prepare('VACUUM INTO ?').run(result.file)
  chmodSync(result.file, 0o600)
  const db = new DatabaseSync(result.file)
  try {
    db.prepare('UPDATE admin_sessions SET revoked = 1').run()
  } finally {
    db.close()
  }
  return { ...result, summary: inspectBackup(result.file) }
}
/** Restore into a separate file. The running workspace and all its records remain untouched. */
export function restoreCopy(ctx: Ctx, content: Buffer, root = RECOVERY_ROOT) {
  if (content.length < 100 || content.subarray(0, 16).toString() !== 'SQLite format 3\u0000')
    throw new HttpError(422, 'BACKUP_INVALID', '请选择 MorphOS 导出的 SQLite 备份文件')
  const result = allocate(root, 'restore')
  writeFileSync(result.file, content, { flag: 'wx', mode: 0o600 })
  const summary = inspectBackup(result.file)
  // Snapshot the current workspace as an additional fallback, without replacing either database.
  const safety = createBackup(ctx, root)
  const db = new DatabaseSync(result.file)
  try {
    db.prepare('UPDATE admin_sessions SET revoked = 1').run()
    db.prepare('UPDATE view_links SET revoked_at = ? WHERE revoked_at IS NULL').run(ctx.now().toISOString())
    db.prepare('UPDATE admin_login_limit SET attempts = 0, reset_at = 0 WHERE id = 1').run()
  } finally {
    db.close()
  }
  return {
    id: result.id,
    summary,
    safetyBackup: path.basename(safety.file),
    command: `npm run start:restored -- ${result.id}`,
  }
}
export function backupBytes(ctx: Ctx, root = RECOVERY_ROOT) {
  const backup = createBackup(ctx, root)
  return { ...backup, content: readFileSync(backup.file) }
}
