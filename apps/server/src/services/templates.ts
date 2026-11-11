/** Built-in templates and their sample data (fixtures/). Templates are pure AppDefinition data. */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { type AppDefinition, addDays, REGISTRY, validateDefinition } from '@morphos/shared'
import { REPO_ROOT } from '../config'
import { notFound } from '../errors'

export interface TemplateInfo {
  id: string
  name: string
  description: string
  icon: string
  fieldCount: number
  componentCount: number
  sampleCount: number
  definition: AppDefinition
}

const TEMPLATE_IDS = ['event-registration', 'equipment-lending'] as const
const FIXTURES = path.join(REPO_ROOT, 'fixtures')

function readJson(file: string): unknown {
  return JSON.parse(readFileSync(file, 'utf8'))
}

let cache: { info: TemplateInfo; samples: Record<string, unknown>[] }[] | undefined

function load() {
  cache ??= TEMPLATE_IDS.map((id) => {
    const r = validateDefinition(readJson(path.join(FIXTURES, 'templates', `${id}.json`)))
    if (!r.ok || !r.definition) throw new Error(`Template ${id} is invalid: ${JSON.stringify(r.issues)}`)
    const def = r.definition
    const samples = (
      readJson(path.join(FIXTURES, 'samples', `${id}.json`)) as { records: Record<string, unknown>[] }
    ).records
    return {
      info: {
        id,
        name: def.name,
        description: def.description ?? '',
        icon: def.icon,
        fieldCount: def.entities[0]?.fields.length ?? 0,
        componentCount: def.nodes.filter((n) => REGISTRY[n.type].visual).length,
        sampleCount: samples.length,
        definition: def,
      },
      samples,
    }
  })
  return cache
}

export function listTemplates(): TemplateInfo[] {
  return load().map((t) => t.info)
}

export function getTemplate(id: string): { info: TemplateInfo; samples: Record<string, unknown>[] } {
  const t = load().find((x) => x.info.id === id)
  if (!t) throw notFound('模板')
  return t
}

/** Resolves `{ "$daysAgo": N }` placeholders so sample dates stay relative to the day they are imported. */
export function resolveSamples(samples: Record<string, unknown>[], today: string): Record<string, unknown>[] {
  return samples.map((rec) =>
    Object.fromEntries(
      Object.entries(rec).map(([k, v]) => {
        if (v && typeof v === 'object' && '$daysAgo' in v) {
          return [k, addDays(today, -Number((v as { $daysAgo: number }).$daysAgo))]
        }
        return [k, v]
      }),
    ),
  )
}
