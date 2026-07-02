import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export async function GET() {
  const { count, error } = await supabase
    .from('personas')
    .select('id', { count: 'exact', head: true })
  return NextResponse.json({ ok: !error, count })
}
