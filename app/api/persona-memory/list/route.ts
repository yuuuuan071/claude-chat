import { getSupabase } from '@/lib/supabase'

export async function GET(req: Request) {
  const personaId = new URL(req.url).searchParams.get('personaId')
  if (!personaId) {
    return Response.json({ error: 'missing personaId' }, { status: 400 })
  }

  const supabase = getSupabase()

  const { data: memories, error: memoriesError } = await supabase
    .from('persona_memories')
    .select('id, content, source_type, created_at')
    .eq('persona_id', personaId)
    .eq('is_active', true)
    .order('created_at', { ascending: false })

  if (memoriesError) return Response.json({ error: memoriesError.message }, { status: 500 })

  const { data: summaryRow, error: summaryError } = await supabase
    .from('persona_summaries')
    .select('summary')
    .eq('persona_id', personaId)
    .maybeSingle()

  if (summaryError) return Response.json({ error: summaryError.message }, { status: 500 })

  return Response.json({ memories: memories ?? [], summary: summaryRow?.summary ?? null })
}
