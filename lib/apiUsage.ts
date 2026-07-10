import { getSupabase } from './supabase'

export function resolveMemoryApiKey(): string {
  const memoryKey = process.env.OPENROUTER_MEMORY_API_KEY
  if (memoryKey) return memoryKey
  console.warn('resolveMemoryApiKey: OPENROUTER_MEMORY_API_KEY not set, falling back to ANTHROPIC_API_KEY')
  return process.env.ANTHROPIC_API_KEY || ''
}

type ApiUsageEvent = {
  purpose: string
  model?: string
  prompt_tokens?: number
  completion_tokens?: number
  duration_ms?: number
  status: 'success' | 'error'
  error_message?: string
}

// Fire-and-forget: never await this, never let it affect the caller's control flow.
export function logApiUsage(event: ApiUsageEvent): void {
  try {
    getSupabase()
      .from('api_usage_events')
      .insert({
        purpose: event.purpose,
        model: event.model ?? null,
        prompt_tokens: event.prompt_tokens ?? null,
        completion_tokens: event.completion_tokens ?? null,
        duration_ms: event.duration_ms ?? null,
        status: event.status,
        error_message: event.error_message?.slice(0, 500) ?? null,
      })
      .then(({ error }) => {
        if (error) console.error('logApiUsage: insert failed', error.message)
      })
  } catch (e) {
    console.error('logApiUsage: unexpected error', e)
  }
}
