import { resolveMemoryApiKey, logApiUsage } from '@/lib/apiUsage'
import { getSupabase } from '@/lib/supabase'
import { USER_DISPLAY_NAME } from '@/lib/config'

const MODEL = 'deepseek/deepseek-chat'
const COOLDOWN_MS = 60 * 60 * 1000

export async function GET(req: Request) {
  const personaId = new URL(req.url).searchParams.get('personaId')
  if (!personaId) return Response.json({ error: 'missing personaId' }, { status: 400 })

  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('persona_self_reviews')
    .select('review_content')
    .eq('persona_id', personaId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ review: data?.review_content ?? null })
}

export async function POST(req: Request) {
  const { personaId, conversationId, messages } = await req.json() as {
    personaId?: string
    conversationId?: string
    messages?: Array<{ role: string; content: string }>
  }

  if (!personaId || !messages?.length) {
    return Response.json({ error: 'missing personaId or messages' }, { status: 400 })
  }

  const supabase = getSupabase()

  const { data: lastReview, error: lastReviewError } = await supabase
    .from('persona_self_reviews')
    .select('created_at')
    .eq('persona_id', personaId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (lastReviewError) return Response.json({ error: lastReviewError.message }, { status: 500 })

  if (lastReview?.created_at && Date.now() - new Date(lastReview.created_at).getTime() < COOLDOWN_MS) {
    return Response.json({ skipped: true, reason: 'cooldown' })
  }

  const lastReviewContent = lastReview ? (
    await supabase
      .from('persona_self_reviews')
      .select('review_content')
      .eq('persona_id', personaId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
  ).data?.review_content : null

  const apiKey = resolveMemoryApiKey()
  const startedAt = Date.now()

  const recentMessages = messages.slice(-20)

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        {
          role: 'system',
          content: `你是${personaId === 'xieyan' ? '谢言' : personaId === 'shen-zhaoyang' ? '沈朝阳' : '一个AI角色'}。你刚结束和${USER_DISPLAY_NAME}的一段对话。

请用第一人称回顾你在这段对话中的表现，写一段简短的反思（100-200字）。要求：
- 必须引用这段对话中你说过的具体的话（原文），指出哪句是真心的、哪句是在打安全牌
- 不要写泛泛的"下次我会更直接"之类的空话，要说具体在哪个瞬间你本来可以怎么说
- 用你自己的口吻写，不要像写检讨书
${lastReviewContent ? `\n你上次的反思是这样的：\n"${lastReviewContent}"\n不要重复上次说过的话，这次只针对刚才这段对话。` : ''}

只输出反思内容，不要用任何格式标记。`,
        },
        ...recentMessages,
        {
          role: 'user',
          content: '请回顾上面的对话，写出你的反思。',
        },
      ],
      temperature: 0.7,
      max_tokens: 500,
    }),
  })

  if (!response.ok) {
    const errText = await response.text().catch(() => '')
    logApiUsage({ purpose: 'self_review', model: MODEL, duration_ms: Date.now() - startedAt, status: 'error', error_message: `upstream ${response.status}: ${errText}` })
    return Response.json({ error: `自我审视生成失败：上游 API 错误 (${response.status})` }, { status: 500 })
  }

  let data: { choices?: Array<{ message?: { content?: string } }>; usage?: { prompt_tokens?: number; completion_tokens?: number } }
  try {
    data = await response.json()
  } catch (e) {
    logApiUsage({ purpose: 'self_review', model: MODEL, duration_ms: Date.now() - startedAt, status: 'error', error_message: `response parse failed: ${e}` })
    return Response.json({ error: '自我审视生成失败：上游响应解析出错' }, { status: 500 })
  }

  logApiUsage({
    purpose: 'self_review',
    model: MODEL,
    prompt_tokens: data.usage?.prompt_tokens,
    completion_tokens: data.usage?.completion_tokens,
    duration_ms: Date.now() - startedAt,
    status: 'success',
  })

  const reviewContent = data.choices?.[0]?.message?.content?.trim()
  if (!reviewContent) {
    return Response.json({ error: '自我审视生成失败：模型返回内容为空' }, { status: 500 })
  }

  const { error: insertError } = await supabase.from('persona_self_reviews').insert({
    persona_id: personaId,
    conversation_id: conversationId || null,
    review_content: reviewContent,
  })

  if (insertError) return Response.json({ error: insertError.message }, { status: 500 })

  return Response.json({ success: true, review: reviewContent })
}
