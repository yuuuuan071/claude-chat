import { getSupabase } from '@/lib/supabase'
import { getEmbedding } from '@/lib/embeddings'

const DEFAULT_TOP_K = 8
const MAX_TOP_K = 20

export async function POST(req: Request) {
  const { personaId, query, topK } = await req.json() as {
    personaId?: string
    query?: string
    topK?: number
  }

  if (!personaId || !query) {
    return Response.json({ error: 'missing personaId or query' }, { status: 400 })
  }

  const matchCount = Math.min(Math.max(topK ?? DEFAULT_TOP_K, 1), MAX_TOP_K)

  const queryEmbedding = await getEmbedding(query)

  const supabase = getSupabase()
  const { data, error } = await supabase.rpc('match_persona_memories', {
    query_embedding: queryEmbedding,
    target_persona_id: personaId,
    match_count: matchCount,
  })

  if (error) return Response.json({ error: error.message }, { status: 500 })

  return Response.json({ results: data ?? [] })
}
