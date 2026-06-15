import { generateId } from './utils'

export type MemoryItem = {
    id: string
    content: string
    createdAt: number
  }
  
  export const loadMemory = (): MemoryItem[] => {
    try {
      const saved = localStorage.getItem('memory-items')
      return saved ? JSON.parse(saved) : []
    } catch {
      return []
    }
  }
  
  export const saveMemory = (items: MemoryItem[]) => {
    localStorage.setItem('memory-items', JSON.stringify(items))
  }
  
  export const createMemoryItem = (content: string): MemoryItem => ({
    id: generateId(),
    content,
    createdAt: Date.now(),
  })
  
  export const buildMemoryPrompt = (items: MemoryItem[]): string => {
    if (items.length === 0) return ''
    const lines = items.map(m => `- ${m.content}`).join('\n')
    return `以下是关于用户的记忆，请在对话中自然地运用这些信息，不要刻意提及：\n${lines}`
  }