/**
 * HTTP response shapes shared by server and web (architecture.md §5).
 * Types only — no runtime code, so this module adds nothing to either bundle.
 */
import type { StoredRecord } from './runtime'
import type { AppDefinition } from './schema'

export interface HealthInfo {
  ok: boolean
  protocolVersion: number
  /** Business time zone (ADR-0005); the browser evaluates "today" in this zone too. */
  timeZone: string
  ai: { configured: boolean; model: string; provider: string }
}

export type VersionSource = 'ai' | 'template' | 'restore' | 'manual' | 'recorded'

export interface AppSummary {
  id: string
  name: string
  description: string | null
  icon: string
  version: number
  recordCount: number
  fieldCount: number
  componentCount: number
  hasSampleData: boolean
  lastChange: { source: VersionSource; intent: string | null; summary: string | null; at: string }
  createdAt: string
  updatedAt: string
}

export interface AppDetail {
  id: string
  name: string
  icon: string
  version: number
  definition: AppDefinition
  hasSampleData: boolean
  recordCount: number
  createdAt: string
  updatedAt: string
}

export interface VersionInfo {
  version: number
  source: VersionSource
  intent: string | null
  summary: string | null
  proposalId: string | null
  restoredFrom: number | null
  createdAt: string
}

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

export interface OutboxEntry {
  id: string
  nodeId: string
  channel: string
  recipientCount: number
  messages: { recordId: string; to: string; body: string }[]
  createdAt: string
}

export interface RecordsResponse {
  records: StoredRecord[]
}

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown }
}
