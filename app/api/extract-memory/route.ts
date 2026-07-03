import { getSupabase } from '@/lib/supabase'

export async function POST(req: Request) {
  const supabase = getSupabase()
  const { messages, persona_id, user_id = 'huiyan' } = await req.json()
  if (!messages || messages.length < 2) return Response.json({ skipped: true })

  // 只取最近6条对话做提取
  const recent = messages.slice(-6).map((m: {role: string, content: string}) =>
    `${m.role === 'user' ? '慧妍' : '角色'}: ${m.content}`
  ).join('\n')

  const apiKey = process.env.ANTHROPIC_API_KEY
  const baseUrl = process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com'

  const res = await fetch(`${baseUrl}/v1/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey!,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
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

  if (!res.ok) return Response.json({ error: 'extraction failed' }, { status: 500 })

  const data = await res.json()
  const text = data.content?.[0]?.text?.trim() || '[]'

  let items: Array<{type: string, content: string}> = []
  try {
    items = JSON.parse(text)
  } catch {
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
