import { getSupabase } from '@/lib/supabase'
import { FALLBACK_PERSONAS } from '@/app/personas'

export async function GET(req: Request) {
  const personaId = new URL(req.url).searchParams.get('personaId')
  const supabase = getSupabase()

  if (personaId) {
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

  // 不传 personaId：跨角色全量列表，附带角色名称，供 /memories 管理页使用
  const { data: memories, error: memoriesError } = await supabase
    .from('persona_memories')
    .select('id, persona_id, content, source_type, created_at')
    .eq('is_active', true)
    .order('created_at', { ascending: false })

  if (memoriesError) return Response.json({ error: memoriesError.message }, { status: 500 })

  const { data: personas, error: personasError } = await supabase
    .from('personas')
    .select('id, name')

  if (personasError) return Response.json({ error: personasError.message }, { status: 500 })

  const nameMap = new Map<string, string>()
  for (const p of FALLBACK_PERSONAS) nameMap.set(p.id, p.name)
  for (const p of personas ?? []) nameMap.set(p.id, p.name)

  const withNames = (memories ?? []).map(m => ({
    ...m,
    persona_name: nameMap.get(m.persona_id) ?? m.persona_id,
  }))

  return Response.json({ memories: withNames })
}
