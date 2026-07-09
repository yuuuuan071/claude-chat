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
        content: `从下面这段对话中提取值得长期记住的信息，用JSON数组返回，每条格式为 {type: 类型, content: 内容}。
类型只能是以下四种之一：
- MEMORY: 关于慧妍的基本信息、偏好、性格特点
- EVENT: 发生的具体事件或经历
- MOMENT: 值得珍藏的情感瞬间或有意义的互动
- PROMISES: 角色做出的承诺或约定

只提取满足以下任一条件的内容：
- 关于慧妍的稳定事实：身份、习惯、长期偏好、重要的人际关系
- 慧妍明确表达过的喜好/厌恶/态度
- 有情感权重、或大概率会被再次提起的重要事件或经历
- 慧妍对角色说过的、在关系层面有意义的话

明确不要提取：
- 一次性的操作性对话（调试、测试功能、"你看看这个显示对不对"这类）
- 没有信息量的日常寒暄和过场对话
- 从单次对话过度推断出的性格结论（例如从一句抱怨推断"慧妍是悲观的人"）
- 具体的技术细节（代码、报错内容）

拿不准是否值得记时，宁可不记，允许返回空数组。提取的表述必须贴近慧妍的原话含义，不要添加你自己的解读或推断。

人称规则（必须严格遵守）：
- "慧妍" = 慧妍，始终用名字称呼，禁止用"她""你""用户"指代
- 其他人物一律用具体名字或"慧妍的XX"（如"慧妍的妹妹"），禁止用代词指代
- 每条记忆单独可读：不依赖上下文也能明确知道每个人称指的是谁

如果没有值得提取的内容，返回空数组 []。只返回JSON，不要其他文字。

正确示例："慧妍今天说自己的客户端项目修好了移动端的菜单，语气听起来很有成就感。"
错误示例："她说她把它修好了，我觉得你很厉害。"（指代全部不明）

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
