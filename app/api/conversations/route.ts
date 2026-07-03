import { getSupabase } from '@/lib/supabase'
import { generateId } from '@/app/utils'

export async function GET(req: Request) {
  const supabase = getSupabase()
  const { searchParams } = new URL(req.url)
  const personaId = searchParams.get('persona_id')

  let query = supabase
    .from('conversations')
    .select('*')
    .order('updated_at', { ascending: false })

  if (personaId) query = query.eq('persona_id', personaId)

  const { data, error } = await query
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json(data)
}

export async function DELETE(req: Request) {
  const supabase = getSupabase()
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return Response.json({ error: 'id is required' }, { status: 400 })

  const { error } = await supabase.from('conversations').delete().eq('id', id)
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return new Response(null, { status: 204 })
}

export async function POST(req: Request) {
  const supabase = getSupabase()
  let body: { id?: string; persona_id?: string | null; title?: string; messages?: unknown[]; summary?: string; summarized_count?: number }
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'invalid JSON body' }, { status: 400 })
  }
  const { id, persona_id, title, messages, summary, summarized_count } = body

  const payload = {
    id: id ?? generateId(),
    persona_id: persona_id ?? null,
    title: title ?? '新对话',
    messages: messages ?? [],
    summary: summary ?? '',
    summarized_count: summarized_count ?? 0,
  }

  const { data, error } = await supabase
    .from('conversations')
    .upsert(payload, { onConflict: 'id' })
    .select()
    .single()

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json(data, { status: 200 })
}
