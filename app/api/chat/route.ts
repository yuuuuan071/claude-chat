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
  if (personaId) {
    try {
      const supabase = getSupabase()
      const { data } = await supabase
        .from('persona_summaries')
        .select('summary')
        .eq('persona_id', personaId)
        .maybeSingle()
      if (data?.summary) longTermMemory = data.summary
    } catch {}
  }

  const parts = [
    systemPrompt ?? '',
    longTermMemory ? `【长期记忆】\n${longTermMemory}` : '',
  ].filter(Boolean)
  const fullSystemPrompt = parts.join('\n\n')
  const fullMessages = fullSystemPrompt ? [{ role: 'system', content: fullSystemPrompt }, ...messages] : messages

  const startedAt = Date.now()

  const isAnthropic = resolvedModel.startsWith('anthropic/')

  if (isAnthropic) {
    // Anthropic 原生格式：system 作为顶层字段，分 block 加 cache_control
    const systemBlocks: Array<{ type: string; text: string; cache_control?: { type: string } }> = []

    // 第一块：角色人设（变动频率最低，缓存命中率最高）
    if (systemPrompt) {
      systemBlocks.push({
        type: 'text',
        text: systemPrompt,
        cache_control: { type: 'ephemeral' },
      })
    }

    // 第二块：长期记忆（每次对话内不变，跨对话可能变）
    if (longTermMemory) {
      systemBlocks.push({
        type: 'text',
        text: `【长期记忆】\n${longTermMemory}`,
      })
    }

    const body: Record<string, unknown> = {
      model: resolvedModel,
      messages, // 不含 system message
      stream: true,
      temperature: resolvedTemp,
      max_tokens: 4096,
    }
    if (systemBlocks.length > 0) {
      body.system = systemBlocks
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
