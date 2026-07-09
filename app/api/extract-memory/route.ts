import { getSupabase } from '@/lib/supabase'
import { logApiUsage, resolveMemoryApiKey } from '@/lib/apiUsage'

const MODEL = 'anthropic/claude-haiku-4.5'

export async function POST(req: Request) {
  const supabase = getSupabase()
  const { messages, persona_id, user_id = 'huiyan' } = await req.json()
  if (!messages || messages.length < 2) return Response.json({ skipped: true })

  // 只取最近6条对话做提取
  const recent = messages.slice(-6).map((m: {role: string, content: string}) =>
    `${m.role === 'user' ? '慧妍' : '角色'}: ${m.content}`
  ).join('\n')

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
      max_tokens: 500,
      messages: [{
        role: 'user',
        content: `从下面这段对话中提取值得记住的信息，用JSON数组返回，每条格式为 {type: 类型, content: 内容}。
类型只能是以下四种之一：
- MEMORY: 关于慧妍的基本信息、偏好、性格特点
- EVENT: 发生的具体事件或经历
- MOMENT: 值得珍藏的情感瞬间或有意义的互动
- PROMISES: 角色做出的承诺或约定

如果没有值得提取的内容，返回空数组 []。只返回JSON，不要其他文字。

对话内容：
${recent}`
      }]
    })
  })

  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    console.error('extract-memory: upstream error', res.status, errText.slice(0, 500))
    logApiUsage({ purpose: 'memory_extract', model: MODEL, duration_ms: Date.now() - startedAt, status: 'error', error_message: `upstream ${res.status}: ${errText}` })
    return Response.json({ error: `记忆提取失败：上游 API 错误 (${res.status})` }, { status: 500 })
  }

  let data: { choices?: Array<{ message?: { content?: string } }>; usage?: { prompt_tokens?: number; completion_tokens?: number } }
  try {
    data = await res.json()
  } catch (e) {
    console.error('extract-memory: failed to parse upstream response:', e)
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

  let items: Array<{type: string, content: string}> = []
  try {
    const cleaned = text.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim()
    items = JSON.parse(cleaned)
  } catch (e) {
    console.error('extract-memory: failed to parse extracted JSON:', e, 'raw text:', text)
    return Response.json({ skipped: true })
  }

  if (items.length === 0) return Response.json({ skipped: true })

  // 写入 Supabase
  const { error } = await supabase.from('memories').insert(
    items.map(item => ({ user_id, persona_id, type: item.type, content: item.content }))
  )

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ extracted: items.length })
}
