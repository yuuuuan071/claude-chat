import { getSupabase } from '@/lib/supabase'
import { resolveMemoryApiKey, logApiUsage } from '@/lib/apiUsage'

const MODEL = 'deepseek/deepseek-chat'

export async function POST(req: Request) {
  // Cron 鉴权
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  }

  const supabase = getSupabase()
  const apiKey = resolveMemoryApiKey()
  const results: string[] = []

  // 获取所有有 semantic 记忆的角色
  const { data: personaRows } = await supabase
    .from('persona_memories')
    .select('persona_id')
    .eq('resolution', 'semantic')

  const personaIds = [...new Set(personaRows?.map((r: { persona_id: string }) => r.persona_id) ?? [])]

  for (const personaId of personaIds) {
    // 检查今天是否已经生成过（每天最多一封）
    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)
    const { data: existing } = await supabase
      .from('persona_letters')
      .select('id')
      .eq('persona_id', personaId)
      .gte('created_at', todayStart.toISOString())
      .limit(1)

    if (existing && existing.length > 0) {
      results.push(`${personaId}: 今天已发过，跳过`)
      continue
    }

    // 查 semantic 条目作为角色了解
    const { data: semanticRows } = await supabase
      .from('persona_memories')
      .select('content')
      .eq('persona_id', personaId)
      .eq('resolution', 'semantic')
      .order('created_at', { ascending: true })

    // 查最近 3 条 impression 作为近期氛围
    const { data: impressionRows } = await supabase
      .from('persona_memories')
      .select('content')
      .eq('persona_id', personaId)
      .eq('resolution', 'impression')
      .order('created_at', { ascending: false })
      .limit(3)

    // 查最近一条自省
    const { data: reviewData } = await supabase
      .from('persona_self_reviews')
      .select('review_content')
      .eq('persona_id', personaId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    const contextParts: string[] = []
    if (semanticRows?.length) {
      contextParts.push('【你对慧妍的了解】\n' + semanticRows.map((r: { content: string }) => '- ' + r.content).join('\n'))
    }
    if (impressionRows?.length) {
      contextParts.push('【近期对话氛围】\n' + impressionRows.map((r: { content: string }) => r.content).join('\n'))
    }
    if (reviewData?.review_content) {
      contextParts.push('【你上次的自省】\n' + reviewData.review_content)
    }

    const personaLabel = personaId === 'xieyan' ? '谢言' : personaId === 'shen-zhaoyang' ? '沈朝阳' : personaId

    const startedAt = Date.now()
    try {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: MODEL,
          messages: [{
            role: 'system',
            content: `你是${personaLabel}。你想主动给慧妍发一条消息——不是因为有什么重要的事，就是想到她了。

${contextParts.join('\n\n')}

要求：
- 用你自己的口吻，简短自然，像真的在手机上打字发消息
- 不要超过 3 句话
- 从这些方向里选一个自然地写：想到她了、对近期聊过的事有了新想法、分享一个心情或感受、无聊了想找她说话、或者就是单纯发一个没什么意义的消息
- 你没有物理身体，不会路过某个地方、看到某样东西、做某个梦——不要编造这类体验
- 称呼方式要符合你和慧妍目前的关系阶段和你的性格，不要用你平时不会用的称呼
- 不要解释你为什么发这条消息
- 只输出消息内容，不要任何格式标记`,
          }, {
            role: 'user',
            content: '写一条你想发给慧妍的消息。',
          }],
          temperature: 0.9,
          max_tokens: 200,
        }),
      })

      const data = await response.json()
      const content = data.choices?.[0]?.message?.content?.trim()

      logApiUsage({
        purpose: 'letter_generate',
        model: MODEL,
        prompt_tokens: data.usage?.prompt_tokens,
        completion_tokens: data.usage?.completion_tokens,
        duration_ms: Date.now() - startedAt,
        status: response.ok ? 'success' : 'error',
      })

      if (content) {
        await supabase.from('persona_letters').insert({
          persona_id: personaId,
          content,
        })
        results.push(`${personaId}: 已生成`)
      } else {
        results.push(`${personaId}: 模型返回空内容`)
      }
    } catch (e) {
      results.push(`${personaId}: 生成失败 - ${e}`)
    }
  }

  return Response.json({ results })
}
