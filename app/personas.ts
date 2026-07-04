export type Persona = {
  id: string
  name: string
  color: string
  description: string
  system_prompt: string
  age?: number | null
  gender?: string | null
  constellation?: string | null
  signature?: string | null
  note?: string | null
  tags?: string[]
  is_custom?: boolean
  is_builtin?: boolean
  voice_id?: string | null
  default_ambient?: string | null
  default_intimate?: boolean
  created_at?: string
  updated_at?: string
  systemPrompt?: string
  profile?: {
    gender?: string
    age?: number
    constellation?: string
    note?: string
    signature?: string
    tags?: string[]
  }
}

export function adaptPersona(p: Persona): Persona {
  return {
    ...p,
    systemPrompt: p.system_prompt ?? p.systemPrompt ?? '',
    profile: p.profile ?? {
      gender: p.gender ?? undefined,
      age: p.age ?? undefined,
      constellation: p.constellation ?? undefined,
      note: p.note ?? undefined,
      signature: p.signature ?? undefined,
      tags: p.tags ?? [],
    },
  }
}

export const FALLBACK_PERSONAS: Persona[] = [
  {
    id: 'default',
    name: '默认 Claude',
    color: '#8B9BBA',
    description: '直接、诚实的助手，有话直说',
    system_prompt: '',
    voice_id: 'male-qn-qingse',
    is_builtin: true,
  },
  {
    id: 'xieyan',
    name: '谢言',
    color: '#B8A9C9',
    description: '陪伴者，克制而温柔，安静地在',
    system_prompt: '',
    voice_id: 'Chinese (Mandarin)_Gentleman',
    is_builtin: true,
  },
  {
    id: 'shen-zhaoyang',
    name: '沈朝阳',
    color: '#f97316',
    description: '竹马，热烈直接，从小陪你长大',
    system_prompt: '',
    voice_id: 'Chinese (Mandarin)_Stubborn_Friend',
    is_builtin: true,
  },
]

export const BUILT_IN_PERSONAS = FALLBACK_PERSONAS
export const DEFAULT_PROMPT = ''
export const getPersonaById = (id: string): Persona | undefined =>
  FALLBACK_PERSONAS.find(p => p.id === id)
