/**
 * OpenAI-compatible Chat Completions client (streaming SSE) on Node's built-in fetch.
 * The API key is only ever placed in the Authorization header — never logged, traced or returned.
 */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface Usage {
  promptTokens: number
  completionTokens: number
  reasoningTokens: number
  totalTokens: number
}

export interface ChatResult {
  content: string
  reasoning: string
  usage: Usage | null
  model: string
  finishReason: string | null
}

export interface ChatOptions {
  json: boolean
  signal?: AbortSignal
  onReasoning?: (delta: string) => void
  onContent?: (delta: string) => void
}

export interface LlmClient {
  readonly model: string
  /** 'live' for a real model, 'recorded' for replay of a captured response (always labelled in the UI). */
  readonly origin: 'live' | 'recorded'
  readonly temperature: number | null
  chat(messages: ChatMessage[], opts: ChatOptions): Promise<ChatResult>
}

export type LlmErrorCode =
  | 'LLM_AUTH'
  | 'LLM_RATE_LIMIT'
  | 'LLM_UPSTREAM'
  | 'LLM_TIMEOUT'
  | 'LLM_NETWORK'
  | 'LLM_ABORTED'

export class LlmError extends Error {
  constructor(
    readonly code: LlmErrorCode,
    message: string,
  ) {
    super(message)
  }
}

export interface LiveClientConfig {
  baseUrl: string
  apiKey: string
  model: string
  timeoutMs: number
  maxTokens: number
  temperature: number
}

interface StreamChunk {
  model?: string
  choices?: {
    delta?: { content?: string | null; reasoning_content?: string | null }
    finish_reason?: string | null
  }[]
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
    completion_tokens_details?: { reasoning_tokens?: number }
  } | null
}

function httpError(status: number, body: string): LlmError {
  const detail = body.slice(0, 200).replace(/sk-[A-Za-z0-9]+/g, '[REDACTED]')
  if (status === 401 || status === 403)
    return new LlmError('LLM_AUTH', '模型服务拒绝了密钥，请检查 LLM_API_KEY 是否正确')
  if (status === 402) return new LlmError('LLM_AUTH', '模型账户余额不足，请充值或更换 LLM_API_KEY')
  if (status === 429) return new LlmError('LLM_RATE_LIMIT', '模型服务限流，请稍后重试')
  return new LlmError('LLM_UPSTREAM', `模型服务返回错误（HTTP ${status}）：${detail}`)
}

/** Parses an SSE byte stream into JSON data payloads. */
async function* sseData(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const decoder = new TextDecoder()
  let buf = ''
  for await (const chunk of body as unknown as AsyncIterable<Uint8Array>) {
    buf += decoder.decode(chunk, { stream: true })
    let nl = buf.indexOf('\n')
    while (nl >= 0) {
      const line = buf.slice(0, nl).trim()
      buf = buf.slice(nl + 1)
      if (line.startsWith('data:')) {
        const data = line.slice(5).trim()
        if (data && data !== '[DONE]') yield data
      }
      nl = buf.indexOf('\n')
    }
  }
}

export function createLiveClient(cfg: LiveClientConfig): LlmClient {
  return {
    model: cfg.model,
    origin: 'live',
    temperature: cfg.temperature,
    async chat(messages, opts) {
      const timeout = AbortSignal.timeout(cfg.timeoutMs)
      const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout
      let res: Response
      try {
        res = await fetch(`${cfg.baseUrl}/chat/completions`, {
          method: 'POST',
          signal,
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
          body: JSON.stringify({
            model: cfg.model,
            messages,
            stream: true,
            stream_options: { include_usage: true },
            temperature: cfg.temperature,
            max_tokens: cfg.maxTokens,
            ...(opts.json ? { response_format: { type: 'json_object' } } : {}),
          }),
        })
      } catch (e) {
        throw toLlmError(e, timeout)
      }
      if (!res.ok || !res.body) throw httpError(res.status, await res.text().catch(() => ''))

      const out: ChatResult = {
        content: '',
        reasoning: '',
        usage: null,
        model: cfg.model,
        finishReason: null,
      }
      try {
        for await (const data of sseData(res.body)) {
          let chunk: StreamChunk
          try {
            chunk = JSON.parse(data) as StreamChunk
          } catch {
            continue // keep-alive comments or partial vendor extensions
          }
          if (chunk.model) out.model = chunk.model
          const choice = chunk.choices?.[0]
          const r = choice?.delta?.reasoning_content
          const c = choice?.delta?.content
          if (r) {
            out.reasoning += r
            opts.onReasoning?.(r)
          }
          if (c) {
            out.content += c
            opts.onContent?.(c)
          }
          if (choice?.finish_reason) out.finishReason = choice.finish_reason
          if (chunk.usage) {
            out.usage = {
              promptTokens: chunk.usage.prompt_tokens ?? 0,
              completionTokens: chunk.usage.completion_tokens ?? 0,
              reasoningTokens: chunk.usage.completion_tokens_details?.reasoning_tokens ?? 0,
              totalTokens: chunk.usage.total_tokens ?? 0,
            }
          }
        }
      } catch (e) {
        throw toLlmError(e, timeout)
      }
      return out
    },
  }
}

function toLlmError(e: unknown, timeout: AbortSignal): LlmError {
  if (e instanceof LlmError) return e
  if (timeout.aborted) return new LlmError('LLM_TIMEOUT', '模型响应超时，请重试或缩短需求描述')
  if (e instanceof Error && e.name === 'AbortError') return new LlmError('LLM_ABORTED', '已取消')
  return new LlmError('LLM_NETWORK', '无法连接模型服务，请检查网络或 LLM_BASE_URL')
}
