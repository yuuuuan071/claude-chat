import { getSupabase } from '@/lib/supabase'
import { logApiUsage, resolveMemoryApiKey } from '@/lib/apiUsage'
import { getEmbedding, cosine } from '@/lib/embeddings'

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
        content: `从下面这段对话中提取值得角色长期记住的事实或情绪片段，把每一条都改写成角色的第一人称视角记忆（例如原文"用户说她今天加班到很晚"要改写成"慧妍今天加班到很晚，听起来很累"）。

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

忠实转述原意，禁止编造、替换或修改任何具体事实细节（时间、地点、行为、数字等）。第一人称视角的改写只能调整叙述角度和语气，不能改变事实内容，不能添加解读或推断。如果原文信息不足以支撑某个细节，宁可少写，不要猜测或补充。

人称规则（必须严格遵守）：
- "我" = 角色自己（记忆的叙述者）
- "慧妍" = 慧妍，始终用名字称呼，禁止用"她""你""用户"指代
- 其他人物一律用具体名字或"慧妍的XX"（如"慧妍的妹妹"），禁止用代词指代
- 每条记忆单独可读：不依赖上下文也能明确知道每个人称指的是谁

同一话题/同一件事只输出一条记忆，把相关细节合并进这一条，不要拆成多条相似的记忆分别输出。

拿不准是否值得记时，宁可不记，允许返回空数组。

用JSON数组返回，每条格式为 {content: 改写后的内容}。如果没有值得提取的内容，返回空数组 []。

只返回纯JSON数组，不要用 markdown 代码块（\`\`\`）包裹，不要输出任何其他文字。

正确示例："慧妍今天说自己的客户端项目修好了移动端的菜单，语气听起来很有成就感。"
错误示例："她说她把它修好了，我觉得你很厉害。"（指代全部不明）

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

  if (!Array.isArray(items) || items.length === 0) return Response.json({ inserted: 0, skipped_duplicates: 0 })

  const DUPLICATE_THRESHOLD = 0.92

  const rows: Array<{
    persona_id: string
    content: string
    source_type: string
    source_conversation_id: string
    embedding?: number[]
  }> = []
  let skippedDuplicates = 0

  for (const item of items) {
    let embedding: number[] | undefined
    try {
      embedding = await getEmbedding(item.content)
    } catch (e) {
      console.warn('persona-memory/extract: embedding failed, leaving null for backfill:', e)
    }

    if (embedding) {
      const { data: matches, error: matchError } = await supabase.rpc('match_persona_memories', {
        query_embedding: embedding,
        target_persona_id: personaId,
        match_count: 1,
      })
      if (matchError) {
        console.warn('persona-memory/extract: dedup check failed, inserting anyway:', matchError.message)
      } else {
        const top = matches?.[0]
        if (top && top.similarity >= DUPLICATE_THRESHOLD) {
          skippedDuplicates++
          console.log(`persona-memory/extract: skipped duplicate (similarity ${top.similarity.toFixed(4)}): "${item.content}" ~ existing: "${top.content}"`)
          continue
        }
      }

      const batchMatch = rows.find(row => row.embedding && cosine(embedding!, row.embedding) >= DUPLICATE_THRESHOLD)
      if (batchMatch) {
        skippedDuplicates++
        console.log(`persona-memory/extract: skipped duplicate within batch (similarity ${cosine(embedding, batchMatch.embedding!).toFixed(4)}): "${item.content}" ~ pending: "${batchMatch.content}"`)
        continue
      }
    }

    rows.push({
      persona_id: personaId,
      content: item.content,
      source_type: sourceType,
      source_conversation_id: conversationId,
      embedding,
    })
  }

  if (rows.length === 0) return Response.json({ inserted: 0, skipped_duplicates: skippedDuplicates })

  const { error } = await supabase.from('persona_memories').insert(rows)

  if (error) return Response.json({ error: error.message }, { status: 500 })

  // impression 级别的模糊印象：概括整段对话的话题和氛围，失败不影响主流程
  try {
    const impressionStartedAt = Date.now()
    const impressionRes = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 200,
        messages: [{
          role: 'user',
          content: `请用一两句话概括这段对话的话题和氛围，只保留大方向，不要任何具体细节、数字、引用或人名以外的专有名词。示例："聊了工作上的烦心事，氛围比较低落但后来缓和了。"

只输出概括内容，不要格式标记。

对话内容：
${transcript}`
        }]
      })
    })

    if (!impressionRes.ok) {
      const errText = await impressionRes.text().catch(() => '')
      logApiUsage({ purpose: 'impression_extract', model: MODEL, duration_ms: Date.now() - impressionStartedAt, status: 'error', error_message: `upstream ${impressionRes.status}: ${errText}` })
    } else {
      const impressionData: { choices?: Array<{ message?: { content?: string } }>; usage?: { prompt_tokens?: number; completion_tokens?: number } } = await impressionRes.json()
      logApiUsage({
        purpose: 'impression_extract',
        model: MODEL,
        prompt_tokens: impressionData.usage?.prompt_tokens,
        completion_tokens: impressionData.usage?.completion_tokens,
        duration_ms: Date.now() - impressionStartedAt,
        status: 'success',
      })
      const impressionText = impressionData.choices?.[0]?.message?.content?.trim()
      if (impressionText) {
        await supabase.from('persona_memories').insert({
          persona_id: personaId,
          content: impressionText,
          resolution: 'impression',
          source_type: 'auto_extract',
          source_conversation_id: conversationId,
        })
      }
    }
  } catch (e) {
    console.warn('persona-memory/extract: impression generation failed:', e)
  }

  return Response.json({ inserted: rows.length, skipped_duplicates: skippedDuplicates })
}
