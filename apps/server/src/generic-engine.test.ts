// AC-04 code search (CLAUDE.md constraint 4): the engine has no scenario-specific pages, components or
// branches — scenarios differ only in AppDefinition data. Scripts and tests may name scenarios as data.
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { REPO_ROOT } from './config'

const ROOTS = ['apps/web/src', 'apps/server/src', 'packages/shared/src']
const EXCLUDED = /(\.test\.tsx?$|test-utils\.ts$|test-helpers\.ts$|\/scripts\/)/

function sources(): string[] {
  return ROOTS.flatMap((root) =>
    readdirSync(path.join(REPO_ROOT, root), { recursive: true, encoding: 'utf8' })
      .map((f) => `${root}/${f.split(path.sep).join('/')}`)
      .filter((f) => /\.tsx?$/.test(f) && !EXCLUDED.test(f)),
  )
}

describe('generic engine (AC-04)', () => {
  const files = sources()

  it('scans the web, server and shared sources', () => {
    expect(files.some((f) => f.startsWith('apps/web/src/runtime/'))).toBe(true)
    expect(files.length).toBeGreaterThan(50)
  })

  it('has no file named after a scenario', () => {
    const scenario = /(equipment|device|lending|borrow|checkin|attendee|lecture|registration|signup)/i
    expect(files.filter((f) => scenario.test(f))).toEqual([])
  })

  it('never branches on which app, template or entity is running', () => {
    const branch = [
      /\b(?:app|def|definition|entity|template)\w*\.(?:name|id)\s*[!=]==?\s*['"`]/,
      /\b(?:appName|appId|templateId|entityId)\s*[!=]==?\s*['"`]/,
      /\bcase\s+['"`](?:event-registration|equipment-lending)['"`]/,
    ]
    // `typeof x === 'string'` is a type guard, not a branch on identity.
    const typeGuard = /typeof\s+[\w.?]+\s*[!=]==?\s*['"`]\w+['"`]/g
    const hits = files.flatMap((f) =>
      readFileSync(path.join(REPO_ROOT, f), 'utf8')
        .split('\n')
        .flatMap((line, i) =>
          branch.some((re) => re.test(line.replace(typeGuard, ''))) ? [`${f}:${i + 1}: ${line.trim()}`] : [],
        ),
    )
    expect(hits).toEqual([])
  })
})
