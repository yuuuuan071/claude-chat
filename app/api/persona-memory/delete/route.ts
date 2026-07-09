import { getSupabase } from '@/lib/supabase'

export async function DELETE(req: Request) {
  const { id } = await req.json() as { id?: string }
  if (!id) {
    return Response.json({ error: 'missing id' }, { status: 400 })
  }

  const supabase = getSupabase()
  const { error } = await supabase
    .from('persona_memories')
    .delete()
    .eq('id', id)

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ success: true })
}
