import { getSupabase } from '@/lib/supabase'

export async function PATCH(req: Request) {
  const { id, content, resolution } = await req.json() as { id?: string; content?: string; resolution?: string }
  if (!id || (typeof content !== 'string' && typeof resolution !== 'string')) {
    return Response.json({ error: 'missing id or content/resolution' }, { status: 400 })
  }

  const updates: Record<string, string> = {}
  if (typeof content === 'string' && content.trim()) updates.content = content.trim()
  if (typeof resolution === 'string') updates.resolution = resolution

  const supabase = getSupabase()
  const { error } = await supabase
    .from('persona_memories')
    .update(updates)
    .eq('id', id)

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ success: true })
}
