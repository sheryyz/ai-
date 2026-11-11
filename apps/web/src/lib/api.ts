/** Thin fetch wrapper. Every non-2xx response becomes an ApiError carrying the server's { code, message }. */
import type {
  AppDetail,
  AppSummary,
  HealthInfo,
  MorphDiff,
  OutboxEntry,
  ProposalRecord,
  RecordingInfo,
  Row,
  StoredRecord,
  TemplateInfo,
  VersionInfo,
} from '@morphos/shared'

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message)
  }
}

function isErrorBody(v: unknown): v is { error: { code: string; message: string; details?: unknown } } {
  if (typeof v !== 'object' || v === null || !('error' in v)) return false
  const e = (v as { error: unknown }).error
  return typeof e === 'object' && e !== null && 'code' in e && 'message' in e
}

export async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', '无法连接服务器，请确认服务已启动（npm run dev）')
  }
  if (res.status === 204) return undefined as T
  const data: unknown = await res.json().catch(() => null)
  if (!res.ok) {
    if (isErrorBody(data))
      throw new ApiError(res.status, data.error.code, data.error.message, data.error.details)
    throw new ApiError(res.status, 'HTTP_ERROR', `请求失败（HTTP ${res.status}）`)
  }
  return data as T
}

/** Field-level messages from a RECORD_INVALID error, keyed by field id. */
export function fieldErrors(e: unknown): Record<string, string> {
  if (!(e instanceof ApiError) || !Array.isArray(e.details)) return {}
  const out: Record<string, string> = {}
  for (const d of e.details as { field?: unknown; message?: unknown }[]) {
    if (typeof d.field === 'string' && typeof d.message === 'string') out[d.field] = d.message
  }
  return out
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : '发生未知错误'
}

export const api = {
  health: () => request<HealthInfo>('GET', '/api/health'),
  templates: () => request<{ templates: TemplateInfo[] }>('GET', '/api/templates').then((r) => r.templates),
  apps: () => request<{ apps: AppSummary[] }>('GET', '/api/apps').then((r) => r.apps),
  app: (id: string) => request<{ app: AppDetail }>('GET', `/api/apps/${id}`).then((r) => r.app),
  createFromTemplate: (templateId: string, withSampleData: boolean) =>
    request<{ app: AppDetail }>('POST', '/api/apps', { templateId, withSampleData }).then((r) => r.app),
  updateApp: (id: string, baseVersion: number, changes: { name?: string; description?: string }) =>
    request<{ app: AppDetail }>('PATCH', `/api/apps/${id}`, { baseVersion, ...changes }).then((r) => r.app),

  records: (id: string) =>
    request<{ records: StoredRecord[] }>('GET', `/api/apps/${id}/records`).then((r) => r.records),
  createRecord: (id: string, nodeId: string, values: Record<string, unknown>) =>
    request<{ record: Row }>('POST', `/api/apps/${id}/records`, { nodeId, values }).then((r) => r.record),
  updateRecord: (id: string, nodeId: string, recordId: string, values: Record<string, unknown>) =>
    request<{ record: Row }>('PATCH', `/api/apps/${id}/records/${recordId}`, { nodeId, values }).then(
      (r) => r.record,
    ),
  deleteRecord: (id: string, nodeId: string, recordId: string) =>
    request<void>('DELETE', `/api/apps/${id}/records/${recordId}?node=${encodeURIComponent(nodeId)}`),
  runAction: (id: string, nodeId: string, recordId: string, answers: Record<string, unknown>) =>
    request<{ record: Row }>('POST', `/api/apps/${id}/actions/${nodeId}`, { recordId, answers }).then(
      (r) => r.record,
    ),
  exportUrl: (id: string, nodeId: string) => `/api/apps/${id}/export.csv?node=${encodeURIComponent(nodeId)}`,

  outbox: (id: string) =>
    request<{ outbox: OutboxEntry[] }>('GET', `/api/apps/${id}/outbox`).then((r) => r.outbox),
  recordOutbox: (id: string, nodeId: string) =>
    request<{ entry: OutboxEntry }>('POST', `/api/apps/${id}/outbox`, { nodeId }).then((r) => r.entry),

  proposals: (id: string) =>
    request<{ proposals: ProposalRecord[] }>('GET', `/api/apps/${id}/proposals`).then((r) => r.proposals),
  approve: (proposalId: string) =>
    request<{ proposal: ProposalRecord; appId: string; version: number; app: AppDetail }>(
      'POST',
      `/api/proposals/${proposalId}/approve`,
    ),
  reject: (proposalId: string) =>
    request<{ proposal: ProposalRecord }>('POST', `/api/proposals/${proposalId}/reject`).then(
      (r) => r.proposal,
    ),
  recordings: (appId?: string) =>
    request<{ recordings: RecordingInfo[] }>(
      'GET',
      appId ? `/api/recordings?appId=${encodeURIComponent(appId)}` : '/api/recordings',
    ).then((r) => r.recordings),

  versions: (id: string) =>
    request<{ versions: VersionInfo[] }>('GET', `/api/apps/${id}/versions`).then((r) => r.versions),
  restoreDiff: (id: string, version: number) =>
    request<{ diff: MorphDiff }>('GET', `/api/apps/${id}/versions/${version}/diff`).then((r) => r.diff),
  restore: (id: string, version: number, baseVersion: number) =>
    request<{ version: number; diff: MorphDiff; app: AppDetail }>(
      'POST',
      `/api/apps/${id}/versions/${version}/restore`,
      { baseVersion },
    ),
}
