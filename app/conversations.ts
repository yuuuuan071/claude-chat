import { generateId } from './utils'

export type Message = {
    role: 'user' | 'assistant'
    content: string
    timestamp?: number
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

export const saveConversationToDB = async (conv: Conversation): Promise<void> => {
  try {
    await fetch('/api/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: conv.id,
        title: conv.title,
        messages: conv.messages,
        persona_id: conv.personaId,
        summary: conv.summary,
        summarized_count: conv.summarizedCount,
      }),
    })
  } catch {}
}