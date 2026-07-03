import { generateId } from './utils'

export type Message = {
    role: 'user' | 'assistant'
    content: string
    timestamp?: number
    marked?: boolean
  }

  export type Conversation = {
    id: string
    title: string
    messages: Message[]
    createdAt: number
    updatedAt: number
    personaId?: string
    summary?: string
    summarizedCount?: number
  }

  export const createConversation = (): Conversation => ({
    id: generateId(),
    title: '新对话',
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    summary: '',
    summarizedCount: 0,
  })
  
  export const getTitleFromMessages = (messages: Message[]): string => {
    const first = messages.find(m => m.role === 'user')
    if (!first) return '新对话'
    return first.content.slice(0, 20) + (first.content.length > 20 ? '...' : '')
  }
  
  export const loadConversations = (): Conversation[] => {
    try {
      const saved = localStorage.getItem('conversations')
      return saved ? JSON.parse(saved) : []
    } catch {
      return []
    }
  }
  
  export const saveConversations = (conversations: Conversation[]) => {
    localStorage.setItem('conversations', JSON.stringify(conversations))
  }

export const loadConversationsFromDB = async (): Promise<Conversation[]> => {
  try {
    const res = await fetch('/api/conversations')
    if (!res.ok) return []
    const data = await res.json()
    return data.map((row: { id: string; title: string; messages: Message[]; persona_id?: string; summary?: string; summarized_count?: number; created_at: string; updated_at: string }) => ({
      id: row.id,
      title: row.title,
      messages: row.messages,
      personaId: row.persona_id,
      summary: row.summary ?? '',
      summarizedCount: row.summarized_count ?? 0,
      createdAt: new Date(row.created_at).getTime(),
      updatedAt: new Date(row.updated_at).getTime(),
    }))
  } catch {
    return []
  }
}

const saveAbortControllers: Record<string, AbortController> = {}

export const nextSaveSignal = (id: string): AbortSignal => {
  saveAbortControllers[id]?.abort()
  const controller = new AbortController()
  saveAbortControllers[id] = controller
  return controller.signal
}

export const buildConversationPayload = (conv: Conversation) => ({
  id: conv.id,
  title: conv.title,
  messages: conv.messages,
  persona_id: conv.personaId,
  summary: conv.summary,
  summarized_count: conv.summarizedCount,
})

export const saveConversationToDB = async (conv: Conversation): Promise<boolean> => {
  const payload = buildConversationPayload(conv)

  const attempt = async (): Promise<'ok' | 'failed' | 'aborted'> => {
    try {
      const res = await fetch('/api/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: nextSaveSignal(conv.id),
      })
      return res.ok ? 'ok' : 'failed'
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return 'aborted'
      console.error('保存会话到 Supabase 请求异常:', e)
      return 'failed'
    }
  }

  const first = await attempt()
  if (first === 'ok') return true
  if (first === 'aborted') return false

  const second = await attempt()
  if (second === 'failed') console.error('保存会话到 Supabase 失败（已重试一次）:', conv.id)
  return second === 'ok'
}