import { getSupabase } from '@/lib/supabase'

export async function GET(req: Request) {
  const personaId = new URL(req.url).searchParams.get('personaId')
  if (!personaId) return Response.json({ error: 'missing personaId' }, { status: 400 })

  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('persona_style_anchors')
    .select('content')
    .eq('persona_id', personaId)
    .maybeSingle()

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ content: data?.content ?? null })
}

export async function PUT(req: Request) {
  const { personaId, content } = await req.json() as { personaId?: string; content?: string }
  if (!personaId || typeof content !== 'string') {
    return Response.json({ error: 'missing personaId or content' }, { status: 400 })
  }

  const supabase = getSupabase()
  const { error } = await supabase
    .from('persona_style_anchors')
    .upsert({ persona_id: personaId, content }, { onConflict: 'persona_id' })

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ success: true })
}
