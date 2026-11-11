#!/usr/bin/env node
// Redacts API-key-like strings from exported AI conversation records before they are committed.
// Usage: node scripts/redact-prompts.mjs [dir=docs/prompts]
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const PATTERNS = [/sk-[A-Za-z0-9]{20,}/g, /Bearer\s+[A-Za-z0-9._-]{20,}/g]
const root = path.resolve(process.argv[2] ?? 'docs/prompts')

let changed = 0
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name)
    if (statSync(p).isDirectory()) walk(p)
    else if (/\.(md|txt|json|jsonl)$/i.test(name)) {
      const src = readFileSync(p, 'utf8')
      const out = PATTERNS.reduce((s, re) => s.replace(re, '[REDACTED]'), src)
      if (out !== src) {
        writeFileSync(p, out)
        changed++
        console.log(`redacted: ${path.relative(process.cwd(), p)}`)
      }
    }
  }
}
walk(root)
console.log(changed ? `${changed} file(s) redacted.` : 'No secrets found.')
