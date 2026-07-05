import { getSupabase } from '@/lib/supabase'

export async function DELETE(req: Request) {
  const { conversationId } = await req.json() as { conversationId?: string }
  if (!conversationId) {
    return Response.json({ error: 'missing conversationId' }, { status: 400 })
  }

  const supabase = getSupabase()

  const { error, count } = await supabase
    .from('persona_memories')
    .delete({ count: 'exact' })
    .eq('source_conversation_id', conversationId)

  if (error) return Response.json({ error: error.message }, { status: 500 })

  return Response.json({ deletedCount: count ?? 0 })
}
