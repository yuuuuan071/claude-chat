import { getSupabase } from '@/lib/supabase'
import { generateId } from '@/app/utils'

export async function GET() {
  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('personas')
    .select('*')
    .order('created_at', { ascending: true })

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json(data)
}

export async function POST(req: Request) {
  const supabase = getSupabase()
  const body = await req.json()
  const { id, name, color, system_prompt, description, age, gender, constellation, signature, note, tags, is_custom, voice_id, default_ambient, default_intimate } = body

  if (!name || typeof name !== 'string') {
    return Response.json({ error: 'name is required' }, { status: 400 })
  }

  const payload = {
    id: id ?? generateId(),
    name,
    color: color ?? '#8B9BBA',
    system_prompt: system_prompt ?? '',
    description: description ?? '',
    age: age ?? null,
    gender: gender ?? null,
    constellation: constellation ?? null,
    signature: signature ?? null,
    note: note ?? null,
    tags: tags ?? [],
    is_custom: is_custom ?? true,
    voice_id: voice_id ?? null,
    default_ambient: default_ambient ?? null,
    default_intimate: default_intimate ?? false,
  }

  const { data, error } = await supabase
    .from('personas')
    .upsert(payload, { onConflict: 'id' })
    .select()
    .single()

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json(data, { status: 200 })
}
