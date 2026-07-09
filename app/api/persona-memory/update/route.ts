import { getSupabase } from '@/lib/supabase'

export async function PATCH(req: Request) {
  const { id, content } = await req.json() as { id?: string; content?: string }
  if (!id || typeof content !== 'string' || !content.trim()) {
    return Response.json({ error: 'missing id or content' }, { status: 400 })
  }

  const supabase = getSupabase()
  const { error } = await supabase
    .from('persona_memories')
    .update({ content: content.trim() })
    .eq('id', id)

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ success: true })
}
