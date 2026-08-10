import { resolveMemoryApiKey, logApiUsage } from '@/lib/apiUsage'
import { getSupabase } from '@/lib/supabase'

const MODEL = 'deepseek/deepseek-chat'

export async function POST() {
  const supabase = getSupabase()
  const apiKey = resolveMemoryApiKey()
  const results: string[] = []

  // 获取所有有 impression 条目的 persona
  const { data: personas } = await supabase
    .from('persona_memories')
    .select('persona_id')
    .eq('resolution', 'impression')
    .then(r => ({ data: [...new Set(r.data?.map((d: { persona_id: string }) => d.persona_id) ?? [])] }))

  for (const personaId of personas) {
    // === 周压缩：7-30 天前的 impression 条目 ===
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
    const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

    const { data: weekCandidates } = await supabase
      .from('persona_memories')
      .select('id, content, created_at')
      .eq('persona_id', personaId)
      .eq('resolution', 'impression')
      .lt('created_at', weekAgo)
      .gte('created_at', monthAgo)
      .order('created_at', { ascending: true })

    if (weekCandidates && weekCandidates.length >= 3) {
      const startedAt = Date.now()
      try {
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: MODEL,
            messages: [{
              role: 'user',
              content: `以下是过去一周里多次对话的印象记录，请合并成一段简短的周概括（50-100字），只保留这段时间的整体话题倾向和关系氛围，去掉重复和过时的细节：\n\n${weekCandidates.map((r: { content: string }) => '- ' + r.content).join('\n')}\n\n只输出概括内容。`,
            }],
            temperature: 0.3,
            max_tokens: 200,
          }),
        })

        const data = await response.json()
        const summary = data.choices?.[0]?.message?.content?.trim()

        logApiUsage({ purpose: 'impression_rollup_week', model: MODEL, prompt_tokens: data.usage?.prompt_tokens, completion_tokens: data.usage?.completion_tokens, duration_ms: Date.now() - startedAt, status: response.ok ? 'success' : 'error' })

        if (summary) {
          // 插入周印象
          await supabase.from('persona_memories').insert({
            persona_id: personaId,
            content: summary,
            resolution: 'impression',
            source_type: 'weekly_rollup',
          })
          // 原始条目标记为已归档（软删除）
          const ids = weekCandidates.map((r: { id: string }) => r.id)
          await supabase.from('persona_memories').update({ resolution: 'archived' }).in('id', ids)
          results.push(`${personaId}: 周压缩 ${ids.length} 条 → 1 条`)
        }
      } catch (e) {
        results.push(`${personaId}: 周压缩失败 - ${e}`)
      }
    }

    // === 月压缩：30 天前的 impression 和 weekly_rollup 条目 ===
    const { data: monthCandidates } = await supabase
      .from('persona_memories')
      .select('id, content, created_at')
      .eq('persona_id', personaId)
      .eq('resolution', 'impression')
      .lt('created_at', monthAgo)
      .order('created_at', { ascending: true })

    if (monthCandidates && monthCandidates.length >= 2) {
      const startedAt = Date.now()
      try {
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: MODEL,
            messages: [{
              role: 'user',
              content: `以下是过去一个月的对话印象，请合并成一段简短的月概括（30-60字），只保留最显著的关系动态和反复出现的话题：\n\n${monthCandidates.map((r: { content: string }) => '- ' + r.content).join('\n')}\n\n只输出概括内容。`,
            }],
            temperature: 0.3,
            max_tokens: 150,
          }),
        })

        const data = await response.json()
        const summary = data.choices?.[0]?.message?.content?.trim()

        logApiUsage({ purpose: 'impression_rollup_month', model: MODEL, prompt_tokens: data.usage?.prompt_tokens, completion_tokens: data.usage?.completion_tokens, duration_ms: Date.now() - startedAt, status: response.ok ? 'success' : 'error' })

        if (summary) {
          await supabase.from('persona_memories').insert({
            persona_id: personaId,
            content: summary,
            resolution: 'impression',
            source_type: 'monthly_rollup',
          })
          const ids = monthCandidates.map((r: { id: string }) => r.id)
          await supabase.from('persona_memories').update({ resolution: 'archived' }).in('id', ids)
          results.push(`${personaId}: 月压缩 ${ids.length} 条 → 1 条`)
        }
      } catch (e) {
        results.push(`${personaId}: 月压缩失败 - ${e}`)
      }
    }
  }

  return Response.json({ results })
}
