import { generateId } from './utils'

export type Message = {
    role: 'user' | 'assistant'
    content: string
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