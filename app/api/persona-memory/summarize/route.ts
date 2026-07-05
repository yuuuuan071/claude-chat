import { getSupabase } from '@/lib/supabase'

export async function POST(req: Request) {
  const { personaId } = await req.json() as { personaId?: string }
  if (!personaId) {
    return Response.json({ error: 'missing personaId' }, { status: 400 })
  }

  const supabase = getSupabase()

  const { data: memories, error: memoriesError } = await supabase
    .from('persona_memories')
    .select('content')
    .eq('persona_id', personaId)
    .eq('is_active', true)
    .order('created_at', { ascending: true })

  if (memoriesError) return Response.json({ error: memoriesError.message }, { status: 500 })

  const { data: existingSummary, error: summaryError } = await supabase
    .from('persona_summaries')
    .select('summary, memory_count_at_summary')
    .eq('persona_id', personaId)
    .maybeSingle()

  if (summaryError) return Response.json({ error: summaryError.message }, { status: 500 })

  const memoryCountAtSummary = existingSummary?.memory_count_at_summary ?? 0
  const currentMemoryCount = memories?.length ?? 0

  if (currentMemoryCount <= memoryCountAtSummary + 5) {
    return Response.json({ skipped: true, reason: 'not enough new memories' })
  }

  const memoryText = (memories ?? []).map(m => m.content).join('\n')

  const apiKey = process.env.ANTHROPIC_API_KEY
  const baseUrl = process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com'

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'deepseek/deepseek-chat',
      max_tokens: 800,
      messages: [{
        role: 'user',
        content: `下面是角色的一系列第一人称记忆片段，请把它们整合压缩成一段连贯的、角色视角的总结性记忆（200-400字）。

要求：
- 忠实反映原始记忆内容，不编造新事实
- 只使用记忆片段中出现过的信息进行整合，不要补充、推断或编造原文没有出现过的细节、动机或场景。
- 记忆片段本身是按时间顺序排列的（从早到晚）。整合时请保留粗略的时间感，用类似"早些时候…"、"后来…"、"最近…"这样的过渡词区分不同阶段发生的事，不要把所有内容焊接成一段发生在同一场景里的连续叙事。不同的记忆片段可能来自完全不同的时间和情境，不要暗示它们之间有因果或时间上的直接连续性，除非原文本身能看出这种连续性。
- 语气自然，不要"总结陈词"式的书面语
- 只返回纯文本，不要markdown包裹，不要加任何前后缀说明

记忆片段：
${memoryText}`
      }]
    })
  })

  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    console.error('persona-memory/summarize: upstream error', res.status, errText.slice(0, 500))
    return Response.json({ error: `摘要生成失败：上游 API 错误 (${res.status})` }, { status: 500 })
  }

  let data: { choices?: Array<{ message?: { content?: string } }> }
  try {
    data = await res.json()
  } catch (e) {
    console.error('persona-memory/summarize: failed to parse upstream response:', e)
    return Response.json({ error: '摘要生成失败：上游响应解析出错' }, { status: 500 })
  }
  const summaryText = data.choices?.[0]?.message?.content?.trim()

  if (!summaryText) {
    console.error('persona-memory/summarize: empty summary content from model')
    return Response.json({ error: '摘要生成失败：模型返回内容为空' }, { status: 500 })
  }

  const { error: upsertError } = await supabase
    .from('persona_summaries')
    .upsert({
      persona_id: personaId,
      summary: summaryText,
      memory_count_at_summary: currentMemoryCount,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'persona_id' })

  if (upsertError) return Response.json({ error: upsertError.message }, { status: 500 })

  return Response.json({ summary: summaryText, memoryCount: currentMemoryCount })
}
