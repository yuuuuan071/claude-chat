import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

let client: SupabaseClient | null = null

const getSupabaseKeepalive = (): SupabaseClient => {
  if (!client) {
    client = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )
  }
  return client
}

export async function GET() {
  const supabase = getSupabaseKeepalive()
  const { count, error } = await supabase
    .from('personas')
    .select('id', { count: 'exact', head: true })
  return NextResponse.json({ ok: !error, count })
}
