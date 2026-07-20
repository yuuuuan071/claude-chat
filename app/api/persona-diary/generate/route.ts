import { getSupabase } from '@/lib/supabase'
import { logApiUsage, resolveMemoryApiKey } from '@/lib/apiUsage'

const MODEL = 'deepseek/deepseek-chat'

export async function POST(req: Request) {
  const { personaId, date } = await req.json() as { personaId?: string; date?: string }
  if (!personaId || !date) {
    return Response.json({ error: 'missing personaId or date' }, { status: 400 })
  }

  const supabase = getSupabase()

  // “当天”按北京时间（UTC+8）语义划界，跟现有代码里 `Date.now() + 8*60*60*1000` 的时区约定保持一致
  const dayStart = `${date}T00:00:00+08:00`
  const dayEnd = `${date}T23:59:59.999+08:00`

  const { data: memories, error: memoriesError } = await supabase
    .from('persona_memories')
    .select('content, created_at')
    .eq('persona_id', personaId)
    .eq('is_active', true)
    .gte('created_at', dayStart)
    .lte('created_at', dayEnd)
    .order('created_at', { ascending: true })

  if (memoriesError) return Response.json({ error: memoriesError.message }, { status: 500 })

  if (!memories || memories.length === 0) {
    return Response.json({ skipped: true, reason: 'no memories' })
  }

  const memoryText = memories.map(m => m.content).join('\n')

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
      max_tokens: 1200,
      messages: [{
        role: 'user',
        content: `下面是角色当天的一系列第一人称记忆片段（按时间顺序），请以角色的第一人称视角写一篇当天的日记。

要求：
- 第一人称视角，用"我"指代角色自己
- 慧妍始终用名字称呼，禁止用"她""你""用户"指代
- 保留记忆片段里的具体细节和原话引用，忠实反映原始内容，不编造新事实、动机或场景
- 语气要贴合角色平时说话的调性，但不要写成过度抒情、堆砌辞藻的"日记体范文"，就是把当天经历自然地记下来
- 篇幅要跟素材量匹配：记忆片段少就写短一点，不要为了凑字数硬加内容或反复重复同一件事
- 只输出日记正文，不要加标题、日期、"亲爱的日记"这类开头，也不要任何解释或说明
- 不要用markdown包裹，直接输出纯文本

当天的记忆片段：
${memoryText}`
      }]
    })
  })

  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    console.error('persona-diary/generate: upstream error', res.status, errText.slice(0, 500))
    logApiUsage({ purpose: 'diary_generate', model: MODEL, duration_ms: Date.now() - startedAt, status: 'error', error_message: `upstream ${res.status}: ${errText}` })
    return Response.json({ error: `日记生成失败：上游 API 错误 (${res.status})` }, { status: 500 })
  }

  let data: { choices?: Array<{ message?: { content?: string } }>; usage?: { prompt_tokens?: number; completion_tokens?: number } }
  try {
    data = await res.json()
  } catch (e) {
    console.error('persona-diary/generate: failed to parse upstream response:', e)
    logApiUsage({ purpose: 'diary_generate', model: MODEL, duration_ms: Date.now() - startedAt, status: 'error', error_message: `response parse failed: ${e}` })
    return Response.json({ error: '日记生成失败：上游响应解析出错' }, { status: 500 })
  }
  logApiUsage({
    purpose: 'diary_generate',
    model: MODEL,
    prompt_tokens: data.usage?.prompt_tokens,
    completion_tokens: data.usage?.completion_tokens,
    duration_ms: Date.now() - startedAt,
    status: 'success',
  })
  const content = data.choices?.[0]?.message?.content?.trim()

  if (!content) {
    console.error('persona-diary/generate: empty diary content from model')
    return Response.json({ error: '日记生成失败：模型返回内容为空' }, { status: 500 })
  }

  const { error: upsertError } = await supabase
    .from('persona_diaries')
    .upsert({
      persona_id: personaId,
      diary_date: date,
      content,
      memory_count: memories.length,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'persona_id,diary_date' })

  if (upsertError) return Response.json({ error: upsertError.message }, { status: 500 })

  return Response.json({ content, memory_count: memories.length })
}
