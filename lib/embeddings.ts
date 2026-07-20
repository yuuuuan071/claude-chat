import { logApiUsage, resolveMemoryApiKey } from './apiUsage'

const EMBEDDING_MODEL = 'openai/text-embedding-3-small'

export async function getEmbedding(text: string): Promise<number[]> {
  const apiKey = resolveMemoryApiKey()
  const startedAt = Date.now()

  const res = await fetch('https://openrouter.ai/api/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: text,
    }),
  })

  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    logApiUsage({ purpose: 'memory_embedding', model: EMBEDDING_MODEL, duration_ms: Date.now() - startedAt, status: 'error', error_message: `upstream ${res.status}: ${errText}` })
    throw new Error(`embeddings request failed: ${res.status} ${errText}`)
  }

  const data = await res.json() as { data?: Array<{ embedding?: number[] }>; usage?: { prompt_tokens?: number; total_tokens?: number } }
  const embedding = data.data?.[0]?.embedding

  if (!embedding) {
    logApiUsage({ purpose: 'memory_embedding', model: EMBEDDING_MODEL, duration_ms: Date.now() - startedAt, status: 'error', error_message: 'embeddings response missing data[0].embedding' })
    throw new Error('embeddings response missing data[0].embedding')
  }

  logApiUsage({
    purpose: 'memory_embedding',
    model: EMBEDDING_MODEL,
    prompt_tokens: data.usage?.prompt_tokens,
    duration_ms: Date.now() - startedAt,
    status: 'success',
  })

  return embedding
}
