import { getSupabase } from '@/lib/supabase'
import { logApiUsage } from '@/lib/apiUsage'

type ApiConfig = {
  baseUrl: string
  apiKey: string
  model: string
  llmEndpoint: string
  temperature: number
}

export async function POST(req: Request) {
  const { messages, systemPrompt, personaId, devMode, apiConfig } = await req.json()

  let resolvedUrl: string
  let resolvedKey: string
  let resolvedModel: string
  let resolvedTemp: number
  let resolvedEndpoint: string

  if (devMode === true) {
    resolvedUrl = 'https://openrouter.ai/api/v1'
    resolvedKey = process.env.ANTHROPIC_API_KEY ?? ''
    resolvedModel = 'anthropic/claude-sonnet-4-6'
    resolvedTemp = 0.8
    resolvedEndpoint = '/chat/completions'
  } else if (apiConfig && typeof apiConfig.baseUrl === 'string' && typeof apiConfig.apiKey === 'string') {
    const cfg = apiConfig as ApiConfig
    resolvedUrl = cfg.baseUrl.replace(/\/$/, '')
    resolvedKey = cfg.apiKey
    resolvedModel = cfg.model || 'gpt-4o'
    resolvedTemp = typeof cfg.temperature === 'number' ? cfg.temperature : 0.8
    resolvedEndpoint = cfg.llmEndpoint || '/chat/completions'
  } else {
    return Response.json({ error: '请先在"API 设置"中配置并应用一个 API 配置，或开启开发者模式' }, { status: 400 })
  }

  let longTermMemory = ''
  let styleAnchor = ''
  let selfReview = ''
  if (personaId) {
    const supabase = getSupabase()
    try {
      const { data: semanticRows } = await supabase
        .from('persona_memories')
        .select('content')
        .eq('persona_id', personaId)
        .eq('resolution', 'semantic')
        .order('created_at', { ascending: true })
      if (semanticRows?.length) {
        longTermMemory = semanticRows.map((r: { content: string }) => '- ' + r.content).join('\n')
      } else {
        // fallback: 没有 semantic 条目时仍用 persona_summaries
        const { data: summaryData } = await supabase
          .from('persona_summaries')
          .select('summary')
          .eq('persona_id', personaId)
          .maybeSingle()
        if (summaryData?.summary) longTermMemory = summaryData.summary
      }
    } catch {}
    try {
      const { data: anchorData } = await supabase
        .from('persona_style_anchors')
        .select('content')
        .eq('persona_id', personaId)
        .maybeSingle()
      if (anchorData?.content) styleAnchor = anchorData.content
    } catch {}
    try {
      const { data: reviewData } = await supabase
        .from('persona_self_reviews')
        .select('review_content')
        .eq('persona_id', personaId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (reviewData?.review_content) selfReview = reviewData.review_content
    } catch {}
  }

  const parts = [
    systemPrompt ?? '',
    styleAnchor ? `【语感参考】\n以下是你曾经说过的一段话，作为你语气和表达方式的参照。不要模仿具体内容，而是保持这种说话的质感：\n${styleAnchor}` : '',
    longTermMemory ? `【长期记忆】\n${longTermMemory}` : '',
    selfReview ? `【自省】\n上次对话后你回顾了自己的表现，注意到以下倾向：\n${selfReview}\n在这次对话中，留意这些模式，尽量做出更真实的回应。` : '',
  ].filter(Boolean)
  const fullSystemPrompt = parts.join('\n\n')
  const fullMessages = fullSystemPrompt ? [{ role: 'system', content: fullSystemPrompt }, ...messages] : messages

  const startedAt = Date.now()

  const isAnthropic = resolvedModel.startsWith('anthropic/')

  if (isAnthropic) {
    // Anthropic: system 留在 messages 里，用 content blocks 格式带 cache_control
    const identityParts: string[] = []
    if (systemPrompt) identityParts.push(systemPrompt)
    if (styleAnchor) identityParts.push(`【语感参考】\n以下是你曾经说过的一段话，作为你语气和表达方式的参照。不要模仿具体内容，而是保持这种说话的质感：\n${styleAnchor}`)
    const identityText = identityParts.join('\n\n')

    const systemContent: Array<{ type: string; text: string; cache_control?: { type: string } }> = []
    if (identityText) {
      systemContent.push({
        type: 'text',
        text: identityText,
        cache_control: { type: 'ephemeral' },
      })
    }
    if (longTermMemory) {
      systemContent.push({ type: 'text', text: `【长期记忆】\n${longTermMemory}` })
    }
    if (selfReview) {
      systemContent.push({ type: 'text', text: `【自省】\n上次对话后你回顾了自己的表现，注意到以下倾向：\n${selfReview}\n在这次对话中，留意这些模式，尽量做出更真实的回应。` })
    }

    // system 放在 messages 第一条，content 用 blocks 格式
    const anthropicMessages = systemContent.length > 0
      ? [{ role: 'system', content: systemContent }, ...messages]
      : messages

    const body: Record<string, unknown> = {
      model: resolvedModel,
      messages: anthropicMessages,
      stream: true,
      temperature: resolvedTemp,
      max_tokens: 4096,
    }

    const upstream = await fetch(`${resolvedUrl}${resolvedEndpoint}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resolvedKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })

    if (!upstream.ok) {
      const errText = await upstream.text().catch(() => '')
      logApiUsage({ purpose: 'chat', model: resolvedModel, duration_ms: Date.now() - startedAt, status: 'error', error_message: `upstream ${upstream.status}: ${errText}` })
      return Response.json({ error: `上游 API 错误 (${upstream.status})${errText ? '：' + errText.slice(0, 200) : ''}` }, { status: upstream.status })
    }

    logApiUsage({ purpose: 'chat', model: resolvedModel, duration_ms: Date.now() - startedAt, status: 'success' })
    return new Response(upstream.body, { headers: { 'Content-Type': 'text/event-stream' } })
  }

  const upstream = await fetch(`${resolvedUrl}${resolvedEndpoint}`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${resolvedKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: resolvedModel, messages: fullMessages, stream: true, temperature: resolvedTemp, max_tokens: 4096 }),
  })

  if (!upstream.ok) {
    const errText = await upstream.text().catch(() => '')
    logApiUsage({ purpose: 'chat', model: resolvedModel, duration_ms: Date.now() - startedAt, status: 'error', error_message: `upstream ${upstream.status}: ${errText}` })
    return Response.json({ error: `上游 API 错误 (${upstream.status})${errText ? '：' + errText.slice(0, 200) : ''}` }, { status: upstream.status })
  }

  // 流式响应不在服务端消费 body，拿不到 usage，仅记录耗时与状态，避免拖慢首字节
  logApiUsage({ purpose: 'chat', model: resolvedModel, duration_ms: Date.now() - startedAt, status: 'success' })

  return new Response(upstream.body, { headers: { 'Content-Type': 'text/event-stream' } })
}
