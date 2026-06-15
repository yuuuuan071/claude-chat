import fs from 'fs'
import path from 'path'

function parseMemorySections(content: string, personaName: string | null): string {
  const sections: Record<string, string> = {}
  let current = ''
  for (const line of content.split('\n')) {
    const heading = line.match(/^## (.+)/)
    if (heading) { current = heading[1].trim(); if (!sections[current]) sections[current] = '' }
    else if (current) sections[current] += line + '\n'
  }
  const parts: string[] = []
  const general = sections['通用']?.trim()
  if (general) parts.push(general)
  if (personaName) { const specific = sections[personaName]?.trim(); if (specific) parts.push(specific) }
  return parts.join('\n')
}

type ApiConfig = {
  baseUrl: string
  apiKey: string
  model: string
  llmEndpoint: string
  temperature: number
}

export async function POST(req: Request) {
  const { messages, systemPrompt, personaName, devMode, apiConfig } = await req.json()

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

  let memoryContent = ''
  try {
    const memoryPath = path.join(process.cwd(), 'memory.md')
    memoryContent = parseMemorySections(fs.readFileSync(memoryPath, 'utf-8').trim(), personaName ?? null)
  } catch {}

  const parts = [
    memoryContent ? `以下是关于用户的记忆，请在对话中自然地运用，不要刻意提及：\n${memoryContent}` : '',
    systemPrompt ?? '',
  ].filter(Boolean)
  const fullSystemPrompt = parts.join('\n\n')
  const fullMessages = fullSystemPrompt ? [{ role: 'system', content: fullSystemPrompt }, ...messages] : messages

  const upstream = await fetch(`${resolvedUrl}${resolvedEndpoint}`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${resolvedKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: resolvedModel, messages: fullMessages, stream: true, temperature: resolvedTemp }),
  })

  if (!upstream.ok) {
    const errText = await upstream.text().catch(() => '')
    return Response.json({ error: `上游 API 错误 (${upstream.status})${errText ? '：' + errText.slice(0, 200) : ''}` }, { status: upstream.status })
  }

  return new Response(upstream.body, { headers: { 'Content-Type': 'text/event-stream' } })
}
