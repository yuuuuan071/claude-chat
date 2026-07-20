import { getSupabase } from '@/lib/supabase'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const personaId = url.searchParams.get('personaId')
  const limitParam = url.searchParams.get('limit')
  const limit = limitParam ? Math.min(Math.max(parseInt(limitParam, 10) || 30, 1), 100) : 30

  if (!personaId) {
    return Response.json({ error: 'missing personaId' }, { status: 400 })
  }

  const supabase = getSupabase()

  const { data: diaries, error } = await supabase
    .from('persona_diaries')
    .select('id, diary_date, content, memory_count, created_at, updated_at')
    .eq('persona_id', personaId)
    .order('diary_date', { ascending: false })
    .limit(limit)

  if (error) return Response.json({ error: error.message }, { status: 500 })

  return Response.json({ diaries: diaries ?? [] })
}
