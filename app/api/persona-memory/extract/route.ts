import { getSupabase } from '@/lib/supabase'
import { logApiUsage, resolveMemoryApiKey } from '@/lib/apiUsage'

const MODEL = 'deepseek/deepseek-chat'

type IncomingMessage = { role: string; content: string }

export async function POST(req: Request) {
  const { personaId, conversationId, messages, sourceType = 'auto_extract' } = await req.json() as {
    personaId?: string
    conversationId?: string
    messages?: IncomingMessage[]
    sourceType?: string
  }

  if (!personaId || !conversationId || !messages || messages.length === 0) {
    return Response.json({ error: 'missing personaId, conversationId or messages' }, { status: 400 })
  }

  const supabase = getSupabase()

  const transcript = messages
    .map(m => `${m.role === 'user' ? '慧妍' : '角色'}: ${m.content}`)
    .join('\n')

  const apiKey = resolveMemoryApiKey()
  const baseUrl = process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com'
  const startedAt = Date.now()

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 800,
      messages: [{
        role: 'user',
        content: `从下面这段对话中提取值得记住的事实或情绪片段，把每一条都改写成角色的第一人称视角记忆（例如原文"用户说她今天加班到很晚"要改写成"她今天加班到很晚，听起来很累"）。

忠实转述原意，禁止编造、替换或修改任何具体事实细节（时间、地点、行为、数字等）。第一人称视角的改写只能调整叙述角度和语气，不能改变事实内容。如果原文信息不足以支撑某个细节，宁可少写，不要猜测或补充。

用JSON数组返回，每条格式为 {content: 改写后的内容}。如果没有值得提取的内容，返回空数组 []。

只返回纯JSON数组，不要用 markdown 代码块（\`\`\`）包裹，不要输出任何其他文字。

对话内容：
${transcript}`
      }]
    })
  })

  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    console.error('persona-memory/extract: upstream error', res.status, errText.slice(0, 500))
    logApiUsage({ purpose: 'memory_extract', model: MODEL, duration_ms: Date.now() - startedAt, status: 'error', error_message: `upstream ${res.status}: ${errText}` })
    return Response.json({ error: `记忆提取失败：上游 API 错误 (${res.status})` }, { status: 500 })
  }

  let data: { choices?: Array<{ message?: { content?: string } }>; usage?: { prompt_tokens?: number; completion_tokens?: number } }
  try {
    data = await res.json()
  } catch (e) {
    console.error('persona-memory/extract: failed to parse upstream response:', e)
    logApiUsage({ purpose: 'memory_extract', model: MODEL, duration_ms: Date.now() - startedAt, status: 'error', error_message: `response parse failed: ${e}` })
    return Response.json({ error: '记忆提取失败：上游响应解析出错' }, { status: 500 })
  }
  logApiUsage({
    purpose: 'memory_extract',
    model: MODEL,
    prompt_tokens: data.usage?.prompt_tokens,
    completion_tokens: data.usage?.completion_tokens,
    duration_ms: Date.now() - startedAt,
    status: 'success',
  })
  const text = data.choices?.[0]?.message?.content?.trim() || '[]'

  let items: Array<{ content: string }>
  try {
    const cleaned = text.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim()
    items = JSON.parse(cleaned)
  } catch (e) {
    console.error('persona-memory/extract: failed to parse extracted JSON:', e, 'raw text:', text)
    return Response.json({ error: '记忆提取失败：模型返回内容不是合法 JSON', raw: text }, { status: 500 })
  }

  if (!Array.isArray(items) || items.length === 0) return Response.json({ inserted: 0 })

  const { error } = await supabase.from('persona_memories').insert(
    items.map(item => ({
      persona_id: personaId,
      content: item.content,
      source_type: sourceType,
      source_conversation_id: conversationId,
    }))
  )

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ inserted: items.length })
}
