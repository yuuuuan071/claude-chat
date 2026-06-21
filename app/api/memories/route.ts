import { supabase } from '@/lib/supabase'

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const persona_id = searchParams.get('persona_id')
  const user_id = searchParams.get('user_id') || 'huiyan'

  const query = supabase
    .from('memories')
    .select('*')
    .eq('user_id', user_id)
    .order('created_at', { ascending: false })

  if (persona_id) query.eq('persona_id', persona_id)

  const { data, error } = await query
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json(data)
}

export async function POST(req: Request) {
  const body = await req.json()
  const { persona_id, type, content, user_id = 'huiyan' } = body

  if (!persona_id || !type || !content) {
    return Response.json({ error: 'missing fields' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('memories')
    .insert({ user_id, persona_id, type, content })
    .select()
    .single()

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json(data)
}

export async function DELETE(req: Request) {
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return Response.json({ error: 'missing id' }, { status: 400 })

  const { error } = await supabase.from('memories').delete().eq('id', id)
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ success: true })
}
