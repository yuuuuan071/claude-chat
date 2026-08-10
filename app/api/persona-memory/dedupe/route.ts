import { getSupabase } from '@/lib/supabase'

function bigrams(text: string): Set<string> {
  const s = text.replace(/\s+/g, '')
  const result = new Set<string>()
  for (let i = 0; i < s.length - 1; i++) {
    result.add(s.slice(i, i + 2))
  }
  return result
}

function dice(a: string, b: string): number {
  const ba = bigrams(a)
  const bb = bigrams(b)
  if (ba.size === 0 && bb.size === 0) return 1
  if (ba.size === 0 || bb.size === 0) return 0
  let intersection = 0
  for (const g of ba) {
    if (bb.has(g)) intersection++
  }
  return (2 * intersection) / (ba.size + bb.size)
}

export async function POST() {
  const supabase = getSupabase()
  const THRESHOLD = 0.7

  const { data: rows, error } = await supabase
    .from('persona_memories')
    .select('id, persona_id, content, resolution, created_at')
    .in('resolution', ['detail', 'impression'])
    .order('created_at', { ascending: true })

  if (error) return Response.json({ error: error.message }, { status: 500 })
  if (!rows?.length) return Response.json({ archived: 0, message: 'no rows to check' })

  // 按 persona_id 分组
  const byPersona: Record<string, typeof rows> = {}
  for (const row of rows) {
    const pid = row.persona_id as string
    if (!byPersona[pid]) byPersona[pid] = []
    byPersona[pid].push(row)
  }

  const toArchive: string[] = []

  for (const [, group] of Object.entries(byPersona)) {
    const kept = new Set<number>()
    for (let i = 0; i < group.length; i++) {
      if (kept.has(i)) continue
      for (let j = i + 1; j < group.length; j++) {
        if (kept.has(j)) continue
        if (dice(group[i].content, group[j].content) >= THRESHOLD) {
          // j 是较新的，archive 掉
          toArchive.push(group[j].id)
          kept.add(j)
        }
      }
    }
  }

  if (toArchive.length > 0) {
    await supabase.from('persona_memories').update({ resolution: 'archived' }).in('id', toArchive)
  }

  return Response.json({ archived: toArchive.length, checked: rows.length })
}
