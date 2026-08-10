import { getSupabase } from '@/lib/supabase'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const personaId = url.searchParams.get('personaId')

  const supabase = getSupabase()
  let query = supabase
    .from('persona_letters')
    .select('id, persona_id, content, is_read, created_at')
    .order('created_at', { ascending: false })
    .limit(20)

  if (personaId) {
    query = query.eq('persona_id', personaId)
  }

  const { data, error } = await query
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ letters: data ?? [] })
}
