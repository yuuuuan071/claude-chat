import { NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'

export async function GET() {
  const supabase = getSupabase()
  const { count, error } = await supabase
    .from('personas')
    .select('id', { count: 'exact', head: true })
  return NextResponse.json({ ok: !error, count })
}
