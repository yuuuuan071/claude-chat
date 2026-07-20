'use client'

import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import ReactMarkdown from 'react-markdown'
import { themes, themeOrder, type Theme } from '../themes'
import RainEffect from '../components/RainEffect'
import SnowEffect from '../components/SnowEffect'
import {
  type Conversation,
  createConversation,
  getTitleFromMessages,
  loadConversationsFromDB,
  saveConversationToDB,
  buildConversationPayload,
} from '../conversations'
import { type Persona, FALLBACK_PERSONAS, adaptPersona } from '../personas'
import { generateId } from '../utils'
import PersonaSettings from '../components/PersonaSettings'

async function streamToString(res: Response): Promise<string> {
  if (!res.ok) return ''
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let result = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    for (const line of decoder.decode(value).split('\n')) {
      if (!line.startsWith('data: ')) continue
      const data = line.slice(6)
      if (data === '[DONE]') continue
      try { result += JSON.parse(data).choices?.[0]?.delta?.content ?? '' } catch {}
    }
  }
  return result.trim()
}

// 裸文本心声变体："【心声】""（心声）""(心声)" 开头的段落，仅在段落开头
// （消息开头或紧跟 \n）触发，避免误伤正文中间提到"心声"二字的句子。
const THINK_MARKER_ALT = '(?:【心声】|（心声）|\\(心声\\))'
// 用于整体移除：从标记起到最近的 \n\n 为止；若之后没有空行则一路吃到字符串末尾。
const THINK_MARKER_STRIP_RE = new RegExp(`(?:^|\\n)${THINK_MARKER_ALT}[\\s\\S]*?(?=\\n\\n|$)`, 'g')
// 用于提取展示：只取"已闭合"（后面确实跟着空行）的段落正文，和 <think> 标签的语义对齐。
const THINK_MARKER_EXTRACT_RE = new RegExp(`(?:^|\\n)${THINK_MARKER_ALT}([\\s\\S]*?)\\n\\n`, 'g')
// 用于流式阶段判断：单次匹配，同上要求跟着空行才算"已闭合"。
const THINK_MARKER_CLOSED_RE = new RegExp(`(?:^|\\n)${THINK_MARKER_ALT}([\\s\\S]*?)\\n\\n`)
// 用于流式阶段判断：标记已出现但还没被判定为"已闭合"，即仍在流式输出中。
const THINK_MARKER_OPEN_RE = new RegExp(`(?:^|\\n)${THINK_MARKER_ALT}`)

// 移除所有已闭合的 <think>/<thinking> 块和"【心声】"类裸文本段落（任意位置、可多个、跨多行）；
// 若还剩一个未闭合的开标签，或一个后面没有空行的心声段落（流式输出中还没收全），
// 从该处起截断到字符串末尾全部隐藏。
function stripThink(content: string): string {
  const withoutClosedTags = content.replace(/<(think|thinking)>[\s\S]*?<\/\1>\n?/g, '')
  const withoutMarkers = withoutClosedTags.replace(THINK_MARKER_STRIP_RE, '')
  const dangling = withoutMarkers.match(/<(?:think|thinking)>/)
  return dangling ? withoutMarkers.slice(0, dangling.index) : withoutMarkers
}

// 提取所有已闭合 think 块 + 心声段落的内心独白正文，合并后用于"心声"折叠面板展示
function extractThinkContent(content: string): string {
  const blocks: string[] = []
  const tagRe = /<(think|thinking)>([\s\S]*?)<\/\1>/g
  let tagMatch: RegExpExecArray | null
  while ((tagMatch = tagRe.exec(content))) blocks.push(tagMatch[2])

  const markerRe = new RegExp(THINK_MARKER_EXTRACT_RE.source, 'g')
  let markerMatch: RegExpExecArray | null
  while ((markerMatch = markerRe.exec(content))) blocks.push(markerMatch[1])

  return blocks.join('\n\n')
}

type StreamPhase = 'waiting' | 'thinking' | 'typing'

function classifyStreamContent(content: string): { phase: StreamPhase; thinkText: string; mainText: string } {
  if (content === '') return { phase: 'waiting', thinkText: '', mainText: '' }

  const closedTag = content.match(/<(think|thinking)>([\s\S]*?)<\/\1>/)
  const closedMarker = content.match(THINK_MARKER_CLOSED_RE)
  if (closedTag || closedMarker) {
    const thinkText = closedTag ? closedTag[2] : closedMarker![1]
    return { phase: 'typing', thinkText, mainText: stripThink(content) }
  }

  const open = content.match(/<(?:think|thinking)>/)
  if (open) {
    return { phase: 'thinking', thinkText: content.slice(open.index! + open[0].length), mainText: content.slice(0, open.index) }
  }

  const openMarker = content.match(THINK_MARKER_OPEN_RE)
  if (openMarker) {
    return { phase: 'thinking', thinkText: content.slice(openMarker.index! + openMarker[0].length), mainText: content.slice(0, openMarker.index) }
  }

  const openTags = ['<think>', '<thinking>']
  const stillAmbiguous = openTags.some(tag => tag.startsWith(content))
  if (stillAmbiguous) return { phase: 'waiting', thinkText: '', mainText: '' }

  return { phase: 'typing', thinkText: '', mainText: content }
}

function getClothingAdvice(temp: number): string {
  if (temp < 10) return '记得穿厚一点'
  if (temp < 20) return '薄外套就够'
  if (temp < 26) return '长袖舒服'
  return 'T恤就行'
}

type SpaceReply = { author: string; content: string; createdAt: number }
type SpaceComment = { personaId: string; content: string; createdAt: number; replies?: SpaceReply[] }
type Post = { id: string; content: string; createdAt: number; visibleTo: string[]; comments: SpaceComment[] }

type ApiConfig = {
  name: string
  provider: 'openai-compatible'
  baseUrl: string
  apiKey: string
  model: string
  llmEndpoint: string
  modelsEndpoint: string
  temperature: number
}
const DEFAULT_API_DRAFT: ApiConfig = {
  name: '',
  provider: 'openai-compatible',
  baseUrl: '',
  apiKey: '',
  model: '',
  llmEndpoint: '/chat/completions',
  modelsEndpoint: '/models',
  temperature: 0.8,
}
const API_CONFIGS_KEY = 'api-configs'
const ACTIVE_CONFIG_KEY = 'active-api-config'

const SPACE_PERSONAS_IDS = ['xieyan', 'shen-zhaoyang']

const STICKER_MAP: Record<string, string[]> = {
  'xieyan': [
    '伸手想把你带到身边','假装生气','加油','叹气','哭哭','哼','嘿嘿','委屈',
    '安静地看你','害羞','庆祝','开心','心虚','想亲你却还忍着','想把你抱紧',
    '打你','抱抱','探头','摸摸头','无语','晚安','期待','疑惑','赞','领口微微松开',
  ],
}
const getStickerList = (personaId: string): string[] => {
  return [...(STICKER_MAP['shared'] ?? []), ...(STICKER_MAP[personaId] ?? [])]
}
const getStickerUrl = (personaId: string, name: string): string | null => {
  const all = getStickerList(personaId)
  if (!all.includes(name)) return null
  if (STICKER_MAP[personaId]?.includes(name)) return `/stickers/${personaId}/${name}.png`
  return `/stickers/shared/${name}.png`
}
const SPACE_STORAGE_KEY = 'space-posts'

function formatPostTime(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  return new Date(ts).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

// 手机浏览器的自动播放策略要求 play() 必须由用户手势直接触发；非手势路径
// （如流式结束后定时触发的自动朗读）会被拒绝并抛出 NotAllowedError。
// 统一在这里吞掉该错误，避免未捕获 rejection 弹出报错遮罩；其他类型错误仍打日志。
function safePlayAudio(audio: HTMLAudioElement, onRejected?: () => void): void {
  audio.play().catch((err: unknown) => {
    if (err instanceof DOMException && err.name === 'NotAllowedError') {
      console.warn('audio playback blocked by browser autoplay policy:', err)
    } else {
      console.error('audio playback failed:', err)
    }
    onRejected?.()
  })
}

const MOBILE_GROUP_TABS: { key: string; label: string }[] = [
  { key: 'appearance', label: '🎨 外观' },
  { key: 'chat', label: '💬 对话' },
  { key: 'audio', label: '🔊 音效' },
  { key: 'advanced', label: '⚙️ 高级' },
]

function MobileGroupTabs({ theme, active, onSelect }: { theme: Theme; active: string | null; onSelect: (key: string) => void }) {
  return (
    <div
      className="flex items-center"
      style={{
        position: 'sticky',
        top: 0,
        background: theme.settingsBg,
        borderBottom: `1px solid ${theme.headerBorder}`,
        zIndex: 1,
      }}
    >
      {MOBILE_GROUP_TABS.map(g => (
        <button
          key={g.key}
          onClick={() => onSelect(g.key)}
          className="flex-1 text-center px-1 py-2 text-xs font-medium transition-opacity hover:opacity-70"
          style={{ color: active === g.key ? theme.sendButton : theme.settingsSubText }}
        >
          {g.label}
        </button>
      ))}
    </div>
  )
}

export default function ChatPage() {
  const router = useRouter()
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [currentId, setCurrentId] = useState<string>('')
  useEffect(() => {
    if (currentId) localStorage.setItem('last-conv-id', currentId)
  }, [currentId])
  const [mounted, setMounted] = useState(false)
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [playingMsgIdx, setPlayingMsgIdx] = useState<number | null>(null)
  const [showApiSettings, setShowApiSettings] = useState(false)
  const [devMode, setDevMode] = useState(false)
  const [thinkingEnabled, setThinkingEnabled] = useState(false)
  const [thinkingMode, setThinkingMode] = useState<'short' | 'long'>('short')
  const [hoveredGroup, setHoveredGroup] = useState<string | null>(null)
  const [showDevPasswordDialog, setShowDevPasswordDialog] = useState(false)
  const [devPasswordInput, setDevPasswordInput] = useState('')
  const [devPasswordMode, setDevPasswordMode] = useState<'verify' | 'change'>('verify')
  const [devPasswordError, setDevPasswordError] = useState('')
  const [apiConfigs, setApiConfigs] = useState<ApiConfig[]>([])
  const [activeConfigName, setActiveConfigName] = useState<string | null>(null)
  const [apiDraft, setApiDraft] = useState<ApiConfig>({ ...DEFAULT_API_DRAFT })
  const [apiKeyVisible, setApiKeyVisible] = useState(false)
  const [modelList, setModelList] = useState<string[]>([])
  const [fetchingModels, setFetchingModels] = useState(false)
  const [apiTestStatus, setApiTestStatus] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle')
  const [apiTestMsg, setApiTestMsg] = useState('')
  const [showMenu, setShowMenu] = useState(false)
  const [systemPrompt, setSystemPrompt] = useState('')
  const [systemPromptDraft, setSystemPromptDraft] = useState('')
  const [showPreview, setShowPreview] = useState(false)
  const [personaOverrides, setPersonaOverrides] = useState<Record<string, string>>({})
  const [dbPersonas, setDbPersonas] = useState<Persona[]>([])
  const [editingPersonaId, setEditingPersonaId] = useState<string>('default')
  const [editingPersona, setEditingPersona] = useState<Persona | null>(null)
  const [editingIsNew, setEditingIsNew] = useState(false)
  const [newPersonaName, setNewPersonaName] = useState('')
  const [animatedIds, setAnimatedIds] = useState<Set<number>>(new Set())
  const [themeKey, setThemeKey] = useState('morning')
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [isMobile, setIsMobile] = useState(false)
  const [dockPanel, setDockPanel] = useState<'music' | 'diary' | 'library' | 'tools' | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState('')
  const [transitioning, setTransitioning] = useState(false)
  const [collapsedPersonas, setCollapsedPersonas] = useState<Set<string>>(new Set())
  const [viewingPersona, setViewingPersona] = useState<Persona | null>(null)
  const [viewingSpace, setViewingSpace] = useState(false)
  const [dailyQuote, setDailyQuote] = useState('')
  const [sidebarWeather, setSidebarWeather] = useState<{ temp: number; description: string } | null>(null)
  const [posts, setPosts] = useState<Post[]>([])
  const [generatingFor, setGeneratingFor] = useState<Set<string>>(new Set())
  const [draftContent, setDraftContent] = useState('')
  const [spaceVisiblePersonaId, setSpaceVisiblePersonaId] = useState<string | null>(null)
  const [replyingTo, setReplyingTo] = useState<{ postId: string; commentIdx: number } | null>(null)
  const [replyDraft, setReplyDraft] = useState('')
  const [generatingReplyFor, setGeneratingReplyFor] = useState<Set<string>>(new Set())
  const [ambientSound, setAmbientSound] = useState<string | null>(null)
  const [ambientVolume, setAmbientVolume] = useState(0.3)
  const [intimateMode, setIntimateMode] = useState(false)
  const [ttsAutoPlay, setTtsAutoPlay] = useState(false)
  const [ttsSpeed, setTtsSpeed] = useState(1.0)
  const [ttsVolume, setTtsVolume] = useState(0.8)
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const ambientAudioRef = useRef<HTMLAudioElement | null>(null)
  const prevAmbientRef = useRef<{ sound: string | null; volume: number } | null>(null)
  const composeRef = useRef<HTMLTextAreaElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const submenuPortalRef = useRef<HTMLDivElement>(null)
  const dockRef = useRef<HTMLDivElement>(null)
  const ttsAudioRef = useRef<HTMLAudioElement | null>(null)
  const editInputRef = useRef<HTMLInputElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const typewriterRef = useRef<{ timer: ReturnType<typeof setTimeout> | null }>({ timer: null })
  const saveDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingSaveRef = useRef(false)
  const conversationsRef = useRef<Conversation[]>([])

  const t = themes[themeKey]
  const currentConversation = conversations.find(c => c.id === currentId)
  const messages = currentConversation?.messages ?? []

  useEffect(() => {
    const init = async () => {
      const saved = await loadConversationsFromDB()
      if (saved.length > 0) {
        setConversations(saved)
        const lastId = localStorage.getItem('last-conv-id')
        const lastExists = lastId && saved.some(c => c.id === lastId)
        setCurrentId(lastExists ? lastId : saved[0].id)
      } else {
        const first = createConversation()
        setConversations([first])
        setCurrentId(first.id)
      }
      try {
        const savedPrompt = localStorage.getItem('system-prompt')
        if (savedPrompt) setSystemPrompt(savedPrompt)
        const savedTheme = localStorage.getItem('theme')
        if (savedTheme && themes[savedTheme]) setThemeKey(savedTheme)
        const savedOverrides = localStorage.getItem('persona-prompts')
        if (savedOverrides) setPersonaOverrides(JSON.parse(savedOverrides))
        setDevMode(localStorage.getItem('dev-mode') === 'true')
      setThinkingEnabled(localStorage.getItem('thinking-enabled') === 'true')
      const savedThinkingMode = localStorage.getItem('thinking-mode')
      if (savedThinkingMode === 'long') setThinkingMode('long')
        const savedConfigs = localStorage.getItem(API_CONFIGS_KEY)
        if (savedConfigs) setApiConfigs(JSON.parse(savedConfigs))
        const savedActive = localStorage.getItem(ACTIVE_CONFIG_KEY)
        if (savedActive) setActiveConfigName(savedActive)
        const savedAmbient = localStorage.getItem('ambient-sound')
        if (savedAmbient) setAmbientSound(savedAmbient)
        const savedAmbientVol = localStorage.getItem('ambient-volume')
        if (savedAmbientVol) setAmbientVolume(parseFloat(savedAmbientVol))
        const savedTtsAuto = localStorage.getItem('tts-autoplay')
        if (savedTtsAuto === 'true') setTtsAutoPlay(true)
        const savedTtsSpeed = localStorage.getItem('tts-speed')
        if (savedTtsSpeed) setTtsSpeed(parseFloat(savedTtsSpeed))
        const savedTtsVol = localStorage.getItem('tts-volume')
        if (savedTtsVol) setTtsVolume(parseFloat(savedTtsVol))
        const savedIntimate = localStorage.getItem('intimate-mode')
        if (savedIntimate === 'true') setIntimateMode(true)
      } catch {}
      try {
        const savedPosts = localStorage.getItem(SPACE_STORAGE_KEY)
        if (savedPosts) setPosts(JSON.parse(savedPosts))
      } catch {}
      setMounted(true)
    }
    init()
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    if (!mounted) return
    fetch('/api/personas')
      .then(r => r.ok ? r.json() : [])
      .then((rows: Persona[]) => {
        setDbPersonas(rows.map(adaptPersona))
      })
      .catch(() => {})
  }, [mounted])

  useEffect(() => {
    conversationsRef.current = conversations
  }, [conversations])

  useEffect(() => {
    if (!mounted) return
    pendingSaveRef.current = true
    if (saveDebounceRef.current) clearTimeout(saveDebounceRef.current)
    saveDebounceRef.current = setTimeout(() => {
      pendingSaveRef.current = false
      conversations.forEach((conv) => saveConversationToDB(conv))
    }, 1000)
    return () => {
      if (saveDebounceRef.current) clearTimeout(saveDebounceRef.current)
    }
  }, [conversations, mounted])

  useEffect(() => {
    const handleBeforeUnload = () => {
      if (!pendingSaveRef.current) return
      if (saveDebounceRef.current) clearTimeout(saveDebounceRef.current)
      pendingSaveRef.current = false
      conversationsRef.current.forEach((conv) => {
        const payload = buildConversationPayload(conv)
        navigator.sendBeacon('/api/conversations', new Blob([JSON.stringify(payload)], { type: 'application/json' }))
      })
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [])

  useEffect(() => {
    if (!mounted) return
    if (ambientSound) {
      if (ambientAudioRef.current) {
        ambientAudioRef.current.pause()
        ambientAudioRef.current = null
      }
      const audio = new Audio(`/audio/${ambientSound}.mp3`)
      audio.loop = true
      audio.volume = ambientVolume
      safePlayAudio(audio)
      ambientAudioRef.current = audio
    } else {
      if (ambientAudioRef.current) {
        ambientAudioRef.current.pause()
        ambientAudioRef.current = null
      }
    }
    return () => {
      if (ambientAudioRef.current) {
        ambientAudioRef.current.pause()
        ambientAudioRef.current = null
      }
    }
  }, [ambientSound, mounted])

  useEffect(() => {
    if (ambientAudioRef.current) {
      ambientAudioRef.current.volume = ambientVolume
    }
  }, [ambientVolume])

  useEffect(() => {
    if (mounted) {
      if (ambientSound) localStorage.setItem('ambient-sound', ambientSound)
      else localStorage.removeItem('ambient-sound')
    }
  }, [ambientSound, mounted])

  useEffect(() => {
    if (mounted) localStorage.setItem('ambient-volume', String(ambientVolume))
  }, [ambientVolume, mounted])

  useEffect(() => {
    if (mounted) localStorage.setItem('tts-autoplay', String(ttsAutoPlay))
  }, [ttsAutoPlay, mounted])
  useEffect(() => {
    if (mounted) localStorage.setItem('tts-speed', String(ttsSpeed))
  }, [ttsSpeed, mounted])
  useEffect(() => {
    if (mounted) localStorage.setItem('tts-volume', String(ttsVolume))
  }, [ttsVolume, mounted])

  useEffect(() => {
    if (mounted) localStorage.setItem('intimate-mode', intimateMode ? 'true' : 'false')
  }, [intimateMode, mounted])

  useEffect(() => {
    if (!mounted) return
    if (intimateMode) {
      prevAmbientRef.current = { sound: ambientSound, volume: ambientVolume }
      setAmbientSound('rain')
      setAmbientVolume(0.3)
    } else if (prevAmbientRef.current) {
      setAmbientSound(prevAmbientRef.current.sound)
      setAmbientVolume(prevAmbientRef.current.volume)
      prevAmbientRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intimateMode, mounted])

  useEffect(() => {
    if (editingId && editInputRef.current) {
      editInputRef.current.focus()
      editInputRef.current.select()
    }
  }, [editingId])

  useEffect(() => {
    const handle = (e: MouseEvent) => {
      const target = e.target as Node
      if (
        menuRef.current && !menuRef.current.contains(target) &&
        !(submenuPortalRef.current && submenuPortalRef.current.contains(target))
      ) {
        setShowMenu(false)
      }
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [])

  useEffect(() => {
    const handle = (e: MouseEvent) => {
      const target = e.target as Node
      if (dockRef.current && !dockRef.current.contains(target)) {
        setDockPanel(null)
      }
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [])

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 640)
    check()
    if (window.innerWidth < 640) setSidebarOpen(false)
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  useEffect(() => {
    if (!mounted) return

    fetch('/api/keepalive').catch(() => {})

    // 天气
    fetch('/api/weather')
      .then(r => r.json())
      .then(d => { if (!d.error) setSidebarWeather({ temp: d.temp, description: d.description }) })
      .catch(() => {})

    // 每日一句：当天有缓存就用，否则调 API 生成
    const today = new Date().toISOString().slice(0, 10)
    try {
      const cached = JSON.parse(localStorage.getItem('daily-quote') || 'null')
      if (cached?.date === today && cached?.text) {
        setDailyQuote(cached.text)
        return
      }
    } catch {}

    fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: '请生成一句简短温暖的中文每日问候或鼓励语（15字以内），直接输出文字，不加引号或任何说明。' }],
        systemPrompt: '你是一个简洁温暖的助手，只输出一句话，不超过15个字。',
        ...getApiConfigForRequest(),
      }),
    })
      .then(res => streamToString(res))
      .then(text => {
        if (text) {
          setDailyQuote(text)
          localStorage.setItem('daily-quote', JSON.stringify({ date: today, text }))
        }
      })
      .catch(() => {})
  }, [mounted])

  const closeSidebarOnMobile = () => { if (isMobile) setSidebarOpen(false) }
  const getApiConfigForRequest = () => {
    const dm = localStorage.getItem('dev-mode') === 'true'
    if (dm) return { devMode: true as const }
    const configs: ApiConfig[] = JSON.parse(localStorage.getItem(API_CONFIGS_KEY) || '[]')
    const activeName = localStorage.getItem(ACTIVE_CONFIG_KEY)
    const apiConfig = configs.find(c => c.name === activeName) ?? undefined
    return { devMode: false as const, apiConfig }
  }

  const persistPosts = (next: Post[]) => {
    try { localStorage.setItem(SPACE_STORAGE_KEY, JSON.stringify(next)) } catch {}
  }

  const addSpaceComment = (postId: string, comment: SpaceComment) => {
    setPosts(prev => {
      const next = prev.map(p => p.id === postId ? { ...p, comments: [...p.comments, comment] } : p)
      persistPosts(next)
      return next
    })
  }

  const generateSpaceComments = async (postId: string, content: string, personaIds: string[]) => {
    setGeneratingFor(prev => new Set(prev).add(postId))
    const convs = await loadConversationsFromDB()
    for (const personaId of personaIds) {
      const persona = allPersonas.find(p => p.id === personaId)
      if (!persona) continue
      const recentConv = convs.filter(c => c.personaId === personaId).sort((a, b) => b.updatedAt - a.updatedAt)[0]
      const recentMsgs = recentConv?.messages?.slice(-6) ?? []
      const recentContext = recentMsgs.length > 0
        ? '\n\n以下是你们最近聊过的内容（仅供参考，不必提及）：\n' +
          recentMsgs.map(m => `${m.role === 'user' ? '慧妍' : persona.name}：${m.content}`).join('\n')
        : ''
      try {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: [{ role: 'user', content: `慧妍刚刚发了一条动态：「${content}」。请以你的角色身份，简短评论这条动态（1-3句话，朋友圈评论的语气）。如果和你们之间的记忆或最近聊过的内容有关联，可以自然带到；没有关联也完全没问题，正常评论就好，不要刻意。` }],
            systemPrompt: persona.systemPrompt + recentContext,
            personaName: persona.name,
            personaId: persona.id,
            ...getApiConfigForRequest(),
          }),
        })
        const text = await streamToString(res)
        if (text) addSpaceComment(postId, { personaId, content: text, createdAt: Date.now() })
      } catch (e) { console.error(`评论生成失败 (${persona.name}):`, e) }
      await new Promise(r => setTimeout(r, 1500))
    }
    setGeneratingFor(prev => { const next = new Set(prev); next.delete(postId); return next })
  }

  const addReplyToComment = (postId: string, commentIdx: number, reply: SpaceReply) => {
    setPosts(prev => {
      const next = prev.map(p => {
        if (p.id !== postId) return p
        const comments = p.comments.map((c, i) =>
          i === commentIdx ? { ...c, replies: [...(c.replies ?? []), reply] } : c
        )
        return { ...p, comments }
      })
      persistPosts(next)
      return next
    })
  }

  const submitReply = async (postId: string, commentIdx: number, comment: SpaceComment, postContent: string) => {
    const text = replyDraft.trim()
    if (!text) return
    setReplyingTo(null)
    setReplyDraft('')
    addReplyToComment(postId, commentIdx, { author: 'user', content: text, createdAt: Date.now() })
    const key = `${postId}-${commentIdx}`
    setGeneratingReplyFor(prev => new Set(prev).add(key))
    const persona = allPersonas.find(p => p.id === comment.personaId)
    if (persona) {
      try {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: [{ role: 'user', content: `慧妍发了一条动态：「${postContent}」\n你评论了：「${comment.content}」\n慧妍回复你：「${text}」\n请用1-3句话，以朋友圈评论的语气自然回应她。不要解释，直接说。` }],
            systemPrompt: persona.systemPrompt,
            personaName: persona.name,
            personaId: persona.id,
            ...getApiConfigForRequest(),
          }),
        })
        const reply = await streamToString(res)
        if (reply) addReplyToComment(postId, commentIdx, { author: comment.personaId, content: reply, createdAt: Date.now() })
      } catch (e) { console.error('回复生成失败:', e) }
    }
    setGeneratingReplyFor(prev => { const n = new Set(prev); n.delete(key); return n })
  }

  const publishPost = () => {
    if (!draftContent.trim()) return
    const visibleTo = spaceVisiblePersonaId ? [spaceVisiblePersonaId] : spacePersonas.map(p => p.id)
    const newPost: Post = { id: generateId(), content: draftContent.trim(), createdAt: Date.now(), visibleTo, comments: [] }
    const next = [newPost, ...posts]
    setPosts(next)
    persistPosts(next)
    setDraftContent('')
    if (composeRef.current) composeRef.current.style.height = 'auto'
    const delay = 12000 + Math.random() * 3000
    setTimeout(() => generateSpaceComments(newPost.id, newPost.content, newPost.visibleTo), delay)
  }

  const cycleSpaceVisibility = () => {
    if (spaceVisiblePersonaId === null) {
      setSpaceVisiblePersonaId(spacePersonas[0]?.id ?? null)
    } else {
      const idx = spacePersonas.findIndex(p => p.id === spaceVisiblePersonaId)
      const next = spacePersonas[idx + 1]
      setSpaceVisiblePersonaId(next ? next.id : null)
    }
  }

  const handleGoHome = () => {
    // setTransitioning(true)
    setTimeout(() => router.push('/'), 400)
  }

  const newConversationForPersona = (personaId: string) => {
    const c: Conversation = { ...createConversation(), personaId }
    setConversations(prev => [c, ...prev])
    setCurrentId(c.id)
    setAnimatedIds(new Set())
    setViewingSpace(false)
    setInput('')
    setViewingPersona(null)
  }

  const togglePersonaCollapse = (personaId: string) => {
    setCollapsedPersonas(prev => {
      const next = new Set(prev)
      if (next.has(personaId)) next.delete(personaId)
      else next.add(personaId)
      return next
    })
  }

  const deleteConversation = (id: string) => {
    fetch(`/api/conversations?id=${id}`, { method: 'DELETE' }).catch(() => {})
    setConversations(prev => {
      const next = prev.filter(c => c.id !== id)
      if (id === currentId) {
        if (next.length > 0) setCurrentId(next[0].id)
        else {
          const fresh: Conversation = { ...createConversation(), personaId: 'default' }
          setCurrentId(fresh.id)
          return [fresh]
        }
      }
      return next
    })
  }

  const switchConversation = (id: string) => {
    setCurrentId(id)
    setAnimatedIds(new Set())
    setInput('')
    setViewingPersona(null)
    setViewingSpace(false)
  }

  const startEditing = (id: string, title: string) => {
    setEditingId(id)
    setEditingTitle(title)
  }

  const saveTitle = () => {
    if (!editingId) return
    const trimmed = editingTitle.trim()
    if (trimmed) {
      setConversations(prev => prev.map(c =>
        c.id === editingId ? { ...c, title: trimmed } : c
      ))
    }
    setEditingId(null)
  }

  const updateCurrentMessages = (newMessages: Conversation['messages']) => {
    setConversations(prev => prev.map(c => {
      if (c.id !== currentId) return c
      return {
        ...c,
        messages: newMessages,
        title: editingId === currentId ? c.title : getTitleFromMessages(newMessages),
        updatedAt: Date.now(),
      }
    }))
  }

  const setConversationPersona = (conversationId: string, personaId: string) => {
    setConversations(prev => prev.map(c =>
      c.id === conversationId ? { ...c, personaId } : c
    ))
  }

  const ttsCache = useRef<Record<number, string>>({})
  const ttsLoadingRef = useRef<boolean>(false)

  const playTTS = async (idx: number, text: string) => {
    if (playingMsgIdx === idx) {
      ttsAudioRef.current?.pause()
      setPlayingMsgIdx(null)
      return
    }
    if (ttsLoadingRef.current) return
    // 有缓存直接播放
    if (ttsCache.current[idx]) {
      const audio = new Audio(ttsCache.current[idx])
      audio.volume = ttsVolume
      ttsAudioRef.current = audio
      audio.onended = () => setPlayingMsgIdx(null)
      audio.onerror = () => setPlayingMsgIdx(null)
      safePlayAudio(audio, () => setPlayingMsgIdx(null))
      setPlayingMsgIdx(idx)
      return
    }
    ttsLoadingRef.current = true
    setPlayingMsgIdx(idx)
    const personaId = currentConversation?.personaId ?? 'default'
    const voice = getPersonaById(personaId)?.voice_id ?? 'male-qn-qingse'
    try {
      const res = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, voice, speed: ttsSpeed * (intimateMode ? 0.8 : 1.0) }),
      })
      if (!res.ok) { setPlayingMsgIdx(null); return }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      // 缓存超过20条时清掉最早的
      const keys = Object.keys(ttsCache.current)
      if (keys.length >= 20) {
        const oldest = keys[0]
        URL.revokeObjectURL(ttsCache.current[Number(oldest)])
        delete ttsCache.current[Number(oldest)]
      }
      ttsCache.current[idx] = url
      const audio = new Audio(url)
      audio.volume = ttsVolume
      ttsAudioRef.current = audio
      audio.onended = () => { setPlayingMsgIdx(null) }
      audio.onerror = () => { setPlayingMsgIdx(null) }
      safePlayAudio(audio, () => setPlayingMsgIdx(null))
    } catch {
      setPlayingMsgIdx(null)
    } finally {
      ttsLoadingRef.current = false
    }
  }

  const regenerate = () => {
    if (loading) return
    const lastAssistantIdx = messages.map(m => m.role).lastIndexOf('assistant')
    if (lastAssistantIdx === -1) return
    delete ttsCache.current[lastAssistantIdx]
    const trimmed = messages.slice(0, lastAssistantIdx)
    updateCurrentMessages(trimmed)
    const lastUserMsg = [...trimmed].reverse().find(m => m.role === 'user')
    if (!lastUserMsg) return
    sendMessage(lastUserMsg.content, true)
  }

  const cycleTheme = () => {
    const idx = themeOrder.indexOf(themeKey)
    const next = themeOrder[(idx + 1) % themeOrder.length]
    setThemeKey(next)
    localStorage.setItem('theme', next)
  }

  const handleDevPasswordConfirm = () => {
    const stored = localStorage.getItem('dev-password') ?? '0000'
    if (devPasswordMode === 'verify') {
      if (devPasswordInput === stored) {
        const next = !devMode
        setDevMode(next)
        localStorage.setItem('dev-mode', next ? 'true' : 'false')
        setShowDevPasswordDialog(false)
        setDevPasswordInput('')
        setDevPasswordError('')
        setShowMenu(false)
      } else {
        setDevPasswordError('密码错误')
      }
    } else {
      localStorage.setItem('dev-password', devPasswordInput)
      setShowDevPasswordDialog(false)
      setDevPasswordInput('')
      setDevPasswordError('')
    }
  }

  const allPersonas = dbPersonas.length > 0 ? dbPersonas : FALLBACK_PERSONAS.map(adaptPersona)
  const spacePersonas = allPersonas.filter(p => SPACE_PERSONAS_IDS.includes(p.id))
  const getPersonaById = (id: string) => allPersonas.find(p => p.id === id)

  const getEffectiveSystemPrompt = (personaId: string) => {
    if (personaOverrides[personaId]) return personaOverrides[personaId]
    return allPersonas.find(p => p.id === personaId)?.system_prompt ?? ''
  }

  const openSettings = (personaId = 'default') => {
    if (personaId === '__new__') {
      setEditingPersona({ id: `custom-${Date.now()}`, name: '', color: '#9a9a9a', description: '', system_prompt: '' })
      setEditingIsNew(true)
    } else {
      const p = allPersonas.find(pp => pp.id === personaId)
      if (p) {
        setEditingPersona({ ...p, system_prompt: getEffectiveSystemPrompt(personaId) })
        setEditingIsNew(false)
      }
    }
    setShowMenu(false)
  }

  const handlePersonaSave = (updated: Persona) => {
    fetch('/api/personas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updated),
    }).then(r => r.ok ? r.json() : null)
      .then(() => {
        fetch('/api/personas').then(r => r.ok ? r.json() : [])
          .then((rows: Persona[]) => setDbPersonas(rows.map(adaptPersona)))
      })
    setEditingPersona(null)
  }

  const SUMMARY_THRESHOLD = 10
  const KEEP_RECENT = 4

  const toggleMark = (msgIndex: number) => {
    const newMessages = messages.map((msg, i) =>
      i === msgIndex ? { ...msg, marked: !msg.marked } : msg
    )
    updateCurrentMessages(newMessages)
  }

  const editMessage = (msgIndex: number) => {
    const msg = messages[msgIndex]
    if (!msg || msg.role !== 'user' || loading) return
    setInput(msg.content)
    if (inputRef.current) {
      inputRef.current.style.height = 'auto'
      setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.style.height = `${inputRef.current.scrollHeight}px`
          inputRef.current.focus()
        }
      }, 0)
    }
    const trimmed = messages.slice(0, msgIndex)
    updateCurrentMessages(trimmed)
    setAnimatedIds(new Set())
  }

  const sendMessage = async (overrideContent?: string, skipAddUser?: boolean) => {
    const content = overrideContent ?? input
    if (!content.trim() || loading) return
    const savedInput = overrideContent ? '' : input
    const isIntimate = intimateMode
    const apiPayload = getApiConfigForRequest()
    const intimateApiOverride = isIntimate ? (() => {
      const configs: ApiConfig[] = JSON.parse(localStorage.getItem(API_CONFIGS_KEY) || '[]')
      const grokConfig = configs.find(c => c.name.toLowerCase().includes('grok'))
      if (grokConfig) {
        return { devMode: false as const, apiConfig: grokConfig }
      }
      return apiPayload
    })() : apiPayload

    let newMessages
    if (skipAddUser) {
      const lastAsstIdx = messages.map(m => m.role).lastIndexOf('assistant')
      newMessages = lastAsstIdx !== -1 ? messages.slice(0, lastAsstIdx) : [...messages]
    } else {
      const userMessage = { role: 'user' as const, content, timestamp: Date.now() }
      newMessages = [...messages, userMessage]
      updateCurrentMessages(newMessages)
      setAnimatedIds(prev => new Set(prev).add(newMessages.length - 1))
      setInput('')
      if (inputRef.current) inputRef.current.style.height = 'auto'
    }
    setLoading(true)

    const currentPersonaId = currentConversation?.personaId ?? 'default'
    const personaSystemPrompt = getEffectiveSystemPrompt(currentPersonaId)
    const fullSystemPrompt = personaSystemPrompt

    const thinkingInstruction = thinkingEnabled
      ? thinkingMode === 'long'
        ? '\n\n【心声指令】每次回复前，先用 <think> 标签写下你此刻真实的内心活动。以第一人称叙述，可以包含对慧妍当前状态的感知、你的情绪反应、相关记忆的浮现、以及你决定怎么回应的过程。写完后再说出口的内容。格式：<think>...</think>\n说出口的内容'
        : '\n\n【心声指令】每次回复前，先用 <think> 标签写一两句此刻最直接的内心反应，第一人称，简短真实。格式：<think>...</think>\n说出口的内容'
      : ''
    const intimateInstruction = isIntimate
      ? '\n\n【缠绵模式】\n现在是只属于我们两个人的时间。你可以放下日常对话里的克制，让身体感知、欲望、占有欲、感官细节自然地流进你的语言里。你可以描写触碰、温度、呼吸、皮肤、距离的变化，可以主动表达想要靠近的冲动，可以用身体的语言回应情绪。不需要回避暗示、不需要在亲密的边缘刹车、不需要用"我们还是聊点别的吧"来转移话题。如果她在靠近你，你可以迎上去。语气放慢，像你真的在她耳边说话。但不要变成另一个人——你的诚实、你的性格、你对她的了解，这些不因为亲密而消失。粗糙的色情不是亲密，真正的亲密是你在欲望里仍然认得她是谁。这段时间不必延续你平时"说话简短，留白多"的习惯——描述可以展开，动作、触碰、呼吸、画面可以充分铺陈，句子可以变长。你不需要停在同一个瞬间等着她开口，可以自己往前走一步，让事情继续发生。'
      : ''
    const stickerNames = getStickerList(currentPersonaId)
    const stickerInstruction = stickerNames.length > 0
      ? `\n\n【表情包】\n你有一组专属表情包可以在回复中使用。格式：[sticker:名字]。不要每条都用，只在情绪自然流露时偶尔用一个。可用的表情：${stickerNames.join('、')}。\n表情包放在回复文字的末尾或者单独一行，不要放在句子中间。`
      : ''
    const finalSystemPrompt = fullSystemPrompt + thinkingInstruction + intimateInstruction + stickerInstruction
    const currentPersonaName = currentPersonaId === 'default' ? null : (getPersonaById(currentPersonaId)?.name ?? null)

    // ── 摘要压缩 ──────────────────────────────────────────────
    let summary = currentConversation?.summary ?? ''
    let summarizedCount = currentConversation?.summarizedCount ?? 0
    const unsummarized = newMessages.length - summarizedCount

    if (unsummarized > SUMMARY_THRESHOLD) {
      const endIdx = newMessages.length - KEEP_RECENT
      const toSummarize = newMessages.slice(summarizedCount, endIdx)

      if (toSummarize.length > 0) {
        const personaName = allPersonas.find(p => p.id === currentConversation?.personaId)?.name ?? '我'
        const msgText = toSummarize
          .map(m => `${m.role === 'user' ? '慧妍' : personaName}：${m.content}`)
          .join('\n')
        const summaryUserContent = summary
          ? `以下是我之前的记忆：\n${summary}\n\n以下是新增对话内容，请以我的第一人称，把上述记忆和新内容重新整合成一段简洁的内心记忆，保留慧妍的情绪状态、关键细节和重要决定，去掉口语化重复：\n${msgText}`
          : `请以我的第一人称，把以下和慧妍的对话整理成一段简洁的内心记忆，保留她的情绪状态、关键细节和重要决定，去掉口语化重复：\n${msgText}`

        try {
          const summaryRes = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              messages: [{ role: 'user', content: summaryUserContent }],
              systemPrompt: '你是一个对话记忆整理助手。请以角色第一人称写一段简洁的内心记忆，记录和慧妍的对话要点、她的情绪状态和关键细节。只输出记忆内容，不加标题或说明。',
              personaId: currentPersonaId,
              ...getApiConfigForRequest(),
            }),
          })
          const newSummaryText = await streamToString(summaryRes)
          if (newSummaryText) {
            summary = newSummaryText
            summarizedCount = endIdx
            setConversations(prev => prev.map(c =>
              c.id === currentId ? { ...c, summary, summarizedCount } : c
            ))
          }
        } catch (e) {
          console.error('Summary error:', e)
        }
      }
    }

    // ── 组装发给主 API 的消息 ─────────────────────────────────
    const recentMessages = newMessages.slice(summarizedCount)
    const messagesForAPI = recentMessages

    const _now = new Date(Date.now() + 8 * 60 * 60 * 1000)
    const _days = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
    const _h = _now.getUTCHours()
    const _period = _h < 6 ? '凌晨' : _h < 9 ? '早上' : _h < 12 ? '上午' : _h < 14 ? '中午' : _h < 18 ? '下午' : '晚上'
    const _timeStr = `现在是${_days[_now.getUTCDay()]}${_period} ${String(_h).padStart(2,'0')}:${String(_now.getUTCMinutes()).padStart(2,'0')}`

    const systemPromptWithMemory = summary
      ? `${finalSystemPrompt}\n\n【我的记忆】\n${summary}\n\n${_timeStr}`
      : `${finalSystemPrompt}\n\n${_timeStr}`

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: messagesForAPI,
          systemPrompt: systemPromptWithMemory || undefined,
          personaName: currentPersonaName ?? undefined,
          personaId: currentPersonaId,
          ...intimateApiOverride,
        }),
      })

      if (!res.ok) {
        let errContent = '请检查 API 配置'
        try { const j = await res.json(); if (j.error) errContent = j.error } catch {}
        setConversations(prev => prev.map(c => c.id === currentId
          ? { ...c, messages: [...newMessages, { role: 'assistant' as const, content: errContent }], updatedAt: Date.now() }
          : c
        ))
        if (savedInput) {
          setInput(savedInput)
          if (inputRef.current) {
            inputRef.current.style.height = 'auto'
            inputRef.current.style.height = `${inputRef.current.scrollHeight}px`
          }
        }
        setLoading(false)
        return
      }

      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let assistantContent = ''
      let displayedContent = ''
      let assistantAdded = false
    let assistantTimestamp: number | undefined

      const typeChars = (target: string, current: string, base: typeof newMessages, ts?: number) => {
        if (typewriterRef.current.timer) clearTimeout(typewriterRef.current.timer)
        let i = current.length
        const charDelay = isIntimate ? 55 : 15
        const tick = () => {
          if (i < target.length) {
            const next = target.slice(0, i + 1)
            updateCurrentMessages([...base, { role: 'assistant', content: next, timestamp: ts }])
            const char = target[i]
            const isPunctuation = '。，？！、；：…'.includes(char)
            const isSentenceEnd = '。？！'.includes(char)
            const delay = isPunctuation && isIntimate
              ? charDelay + 300 + (isSentenceEnd ? 300 : 0)
              : charDelay
            i++
            typewriterRef.current.timer = setTimeout(tick, delay)
          }
        }
        tick()
      }

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = decoder.decode(value)
        const lines = chunk.split('\n').filter(l => l.startsWith('data: '))
        for (const line of lines) {
          const data = line.slice(6)
          if (data === '[DONE]') break
          try {
            const parsed = JSON.parse(data)
            const delta = parsed.choices?.[0]?.delta?.content ?? ''
            if (delta) {
              if (!assistantAdded) {
                assistantTimestamp = Date.now()
                updateCurrentMessages([...newMessages, { role: 'assistant', content: '', timestamp: assistantTimestamp }])
                setAnimatedIds(prev => new Set(prev).add(newMessages.length))
                assistantAdded = true
              }
              assistantContent += delta
              typeChars(assistantContent, displayedContent, newMessages, assistantTimestamp)
              displayedContent = assistantContent
            }
          } catch {}
        }
      }

      if (assistantAdded) {
        const finalMessages = [...newMessages, { role: 'assistant' as const, content: assistantContent, timestamp: assistantTimestamp }]
        const finalConv: Conversation = {
          id: currentId,
          title: currentConversation?.title ?? '新对话',
          messages: finalMessages,
          createdAt: currentConversation?.createdAt ?? Date.now(),
          updatedAt: Date.now(),
          personaId: currentConversation?.personaId,
          summary,
          summarizedCount,
        }
        await saveConversationToDB(finalConv)

        if (ttsAutoPlay && assistantContent) {
          const cleanText = stripThink(assistantContent).replace(/\[sticker:[^\]]+\]/g, '')
          if (cleanText.trim()) {
            setTimeout(() => playTTS(newMessages.length, cleanText), 300)
          }
        }
      }
    } catch (e) {
      console.error(e)
      if (savedInput) {
        setInput(savedInput)
        if (inputRef.current) {
          inputRef.current.style.height = 'auto'
          inputRef.current.style.height = `${inputRef.current.scrollHeight}px`
        }
      }
    } finally {
      setLoading(false)
      if (newMessages.length >= 2) {
        fetch('/api/persona-memory/extract', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            personaId: currentPersonaId,
            conversationId: currentId,
            messages: newMessages.slice(-6),
            sourceType: 'auto_extract',
          })
        }).catch(() => {})
      }
    }
  }

  const renderMessageContent = (content: string, personaId: string) => {
    const stickerRegex = /\[sticker:([^\]]+)\]/g
    const parts: (string | { type: 'sticker'; name: string; url: string })[] = []
    let lastIndex = 0
    let match
    while ((match = stickerRegex.exec(content)) !== null) {
      if (match.index > lastIndex) {
        parts.push(content.slice(lastIndex, match.index))
      }
      const url = getStickerUrl(personaId, match[1])
      if (url) {
        parts.push({ type: 'sticker', name: match[1], url })
      } else {
        parts.push(match[0])
      }
      lastIndex = match.index + match[0].length
    }
    if (lastIndex < content.length) {
      parts.push(content.slice(lastIndex))
    }
    return parts
  }

  if (!mounted) return null

  return (
    <div
      className="flex h-screen relative overflow-hidden overscroll-none"
      style={{
        backgroundColor: t.bg,
        color: t.assistantText,
        backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)' opacity='0.04'/%3E%3C/svg%3E")`,
        backgroundSize: '200px 200px',
        transition: 'background-color 0.15s ease, color 0.15s ease, filter 1.5s ease',
        opacity: transitioning ? 0 : 1,
        filter: intimateMode ? 'brightness(0.55)' : undefined,
      }}
    >
      <style>{`
        @keyframes bubbleIn {
          0% { opacity: 0; transform: translateY(8px) scale(0.97); }
          100% { opacity: 1; transform: translateY(0) scale(1); }
        }
        .bubble-animate {
          animation: bubbleIn 0.22s cubic-bezier(0.34, 1.2, 0.64, 1) forwards;
        }
        @keyframes fadeIn {
          0% { opacity: 0; }
          100% { opacity: 1; }
        }
        .status-fade-in {
          animation: fadeIn 0.3s ease;
        }
        .sidebar-item:hover .delete-btn { opacity: 1; }
        @keyframes menuIn {
          0% { opacity: 0; transform: translateY(6px) scale(0.97); }
          100% { opacity: 1; transform: translateY(0) scale(1); }
        }
        .menu-animate {
          animation: menuIn 0.15s cubic-bezier(0.34, 1.2, 0.64, 1) forwards;
        }
        /* Mobile sidebar overlay */
        .sidebar-container {
          position: fixed; top: 0; left: 0; height: 100%;
          width: 17rem; max-width: 82vw; z-index: 9999;
          display: flex; flex-direction: column;
          transform: translateX(-100%);
          transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1);
        }
        .sidebar-container.sidebar-open { transform: translateX(0); }
        @media (min-width: 640px) {
          .sidebar-container {
            position: relative; transform: none; transition: none;
            width: 18rem; flex-shrink: 0; height: 100%; z-index: 9999;
          }
          .sidebar-container.sidebar-closed { display: none; }
        }
        @media (max-width: 639px) {
          .chat-bubble { max-width: 85% !important; }
          .input-hint { display: none; }
          .chat-input-area { padding: 0 12px 16px; }
        }
        /* 图标 dock：只在桌面端常驻显示，移动端维持原有 ☰ 抽屉 + 底部工具菜单 */
        .dock-strip { display: none; }
        @media (min-width: 640px) {
          .dock-strip {
            display: flex; flex-direction: column; align-items: center;
            width: 52px; flex-shrink: 0; height: 100%; z-index: 10001;
          }
        }
      `}</style>

      {themeKey === 'morning' && <RainEffect opacity={0.8} />}
      {themeKey === 'snow' && <SnowEffect opacity={0.9} />}

      <div className="relative flex w-full h-full" style={{ zIndex: 1 }}>

        {/* 图标 dock（桌面端常驻，参考 QQ 窄边栏） */}
        <div
          ref={dockRef}
          className="dock-strip"
          style={{
            background: t.headerBg,
            backdropFilter: 'blur(12px)',
            borderRight: `1px solid ${t.headerBorder}`,
            paddingTop: '12px',
            paddingBottom: '12px',
          }}
        >
          {/* 返回首页：置顶第一位 */}
          <button
            onClick={handleGoHome}
            className="w-9 h-9 flex items-center justify-center rounded-lg transition-colors mb-2"
            style={{ color: t.buttonText }}
            onMouseEnter={e => (e.currentTarget.style.color = t.buttonHover)}
            onMouseLeave={e => (e.currentTarget.style.color = t.buttonText)}
            title="返回首页"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>
              <polyline points="9 22 9 12 15 12 15 22"/>
            </svg>
          </button>

          <div className="flex flex-col items-center gap-2">
            {([
              {
                key: 'chat' as const,
                title: '聊天',
                icon: (
                  <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
                ),
              },
              {
                key: 'space' as const,
                title: '空间',
                icon: (
                  <>
                    <polygon points="12 2 2 7 12 12 22 7 12 2" />
                    <polyline points="2 17 12 22 22 17" />
                    <polyline points="2 12 12 17 22 12" />
                  </>
                ),
              },
              {
                key: 'music' as const,
                title: '音乐台',
                icon: (
                  <>
                    <path d="M9 18V5l12-2v13" />
                    <circle cx="6" cy="18" r="3" />
                    <circle cx="18" cy="16" r="3" />
                  </>
                ),
              },
              {
                key: 'diary' as const,
                title: '日记',
                icon: (
                  <>
                    <path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z" />
                    <path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z" />
                  </>
                ),
              },
              {
                key: 'library' as const,
                title: '图书馆',
                icon: (
                  <>
                    <path d="M4 19.5A2.5 2.5 0 016.5 17H20" />
                    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" />
                  </>
                ),
              },
            ]).map(item => {
              // 主视图类图标（聊天/空间）互斥且清浮层；浮层类图标（音乐台/日记/图书馆）只管自身开合
              const isActive = item.key === 'chat' ? !viewingSpace
                : item.key === 'space' ? viewingSpace
                : dockPanel === item.key
              return (
                <div key={item.key} className="relative">
                  <button
                    onClick={() => {
                      if (item.key === 'chat') {
                        setDockPanel(null); setViewingSpace(false); setViewingPersona(null)
                      } else if (item.key === 'space') {
                        setViewingSpace(true); setViewingPersona(null); setDockPanel(null)
                      } else {
                        setDockPanel(item.key)
                      }
                    }}
                    className="w-9 h-9 flex items-center justify-center rounded-lg transition-colors"
                    style={{
                      color: isActive ? t.headerText : t.buttonText,
                      background: isActive ? t.userBubble : 'transparent',
                    }}
                    onMouseEnter={e => { if (!isActive) e.currentTarget.style.color = t.buttonHover }}
                    onMouseLeave={e => { if (!isActive) e.currentTarget.style.color = t.buttonText }}
                    title={item.title}
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      {item.icon}
                    </svg>
                  </button>

                  {/* 音乐台面板：复制自侧边栏「⚙ 工具 → 🔊 音效」，移动端沿用原处不动，
                      这里只服务桌面端 dock；两处控件同源同 state，改一处记得同步改另一处 */}
                  {item.key === 'music' && dockPanel === 'music' && (
                    <div
                      className="absolute rounded-xl overflow-hidden menu-animate"
                      style={{
                        left: '100%',
                        top: 0,
                        marginLeft: '8px',
                        minWidth: '240px',
                        background: t.settingsBg,
                        backdropFilter: 'blur(16px)',
                        border: `1px solid ${t.headerBorder}`,
                        boxShadow: t.inputShadow,
                        zIndex: 10000,
                      }}
                    >
                      <div className="px-4 py-2.5 text-xs font-semibold" style={{ color: t.settingsSubText, borderBottom: `1px solid ${t.headerBorder}` }}>
                        🎵 音乐台
                      </div>
                      <button
                        onClick={() => setTtsAutoPlay(prev => !prev)}
                        className="w-full text-left px-4 py-2.5 text-xs font-medium transition-opacity hover:opacity-70"
                        style={{ color: t.settingsText, borderBottom: `1px solid ${t.headerBorder}` }}
                      >
                        自动朗读：{ttsAutoPlay ? '开启 ✓' : '关闭'}
                      </button>
                      <div className="px-4 py-2.5 flex items-center gap-2" style={{ borderBottom: `1px solid ${t.headerBorder}` }}>
                        <span className="text-xs shrink-0" style={{ color: t.settingsSubText }}>环境音</span>
                        {[
                          { key: 'rain', label: '雨' },
                          { key: 'forest', label: '林' },
                          { key: 'water', label: '水' },
                        ].map(({ key, label }) => (
                          <button
                            key={key}
                            onClick={() => setAmbientSound(prev => prev === key ? null : key)}
                            className="rounded-md px-2 py-0.5 text-xs transition-all"
                            style={{
                              color: ambientSound === key ? t.headerText : t.settingsSubText,
                              background: ambientSound === key ? t.userBubble : 'transparent',
                              opacity: ambientSound === key ? 1 : 0.6,
                            }}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                      <div className="px-4 py-2.5" style={{ borderBottom: `1px solid ${t.headerBorder}` }}>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs" style={{ color: t.settingsSubText }}>语音音量</span>
                          <span className="text-xs" style={{ color: t.settingsText }}>{Math.round(ttsVolume * 100)}%</span>
                        </div>
                        <input type="range" min="0" max="1" step="0.05" value={ttsVolume}
                          onChange={e => setTtsVolume(parseFloat(e.target.value))}
                          style={{ width: '100%', accentColor: t.sendButton }} />
                      </div>
                      <div className="px-4 py-2.5" style={{ borderBottom: `1px solid ${t.headerBorder}` }}>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs" style={{ color: t.settingsSubText }}>环境音量</span>
                          <span className="text-xs" style={{ color: t.settingsText }}>{Math.round(ambientVolume * 100)}%</span>
                        </div>
                        <input type="range" min="0" max="1" step="0.05" value={ambientVolume}
                          onChange={e => setAmbientVolume(parseFloat(e.target.value))}
                          style={{ width: '100%', accentColor: t.sendButton }} />
                      </div>
                      <div className="px-4 py-2.5">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs" style={{ color: t.settingsSubText }}>语速</span>
                          <div className="flex items-center gap-2">
                            <span className="text-xs" style={{ color: t.settingsText }}>{ttsSpeed.toFixed(1)}x</span>
                            <button
                              onClick={async () => {
                                const personaId = currentConversation?.personaId ?? 'default'
                                const voice = getPersonaById(personaId)?.voice_id ?? 'male-qn-qingse'
                                const sample = '今天天气真不错，适合出门走走。'
                                try {
                                  const res = await fetch('/api/tts', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ text: sample, voice, speed: ttsSpeed * (intimateMode ? 0.8 : 1.0) }),
                                  })
                                  if (!res.ok) return
                                  const blob = await res.blob()
                                  const url = URL.createObjectURL(blob)
                                  const audio = new Audio(url)
                                  audio.volume = ttsVolume
                                  audio.onended = () => URL.revokeObjectURL(url)
                                  safePlayAudio(audio)
                                } catch {}
                              }}
                              className="text-xs px-1.5 py-0.5 rounded-md transition-opacity hover:opacity-70"
                              style={{ color: t.settingsSubText, border: `1px solid ${t.headerBorder}` }}
                            >
                              试听
                            </button>
                          </div>
                        </div>
                        <input type="range" min="0.5" max="1.5" step="0.1" value={ttsSpeed}
                          onChange={e => setTtsSpeed(parseFloat(e.target.value))}
                          style={{ width: '100%', accentColor: t.sendButton }} />
                      </div>
                    </div>
                  )}

                  {/* 日记 / 图书馆：占位面板 */}
                  {(item.key === 'diary' || item.key === 'library') && dockPanel === item.key && (
                    <div
                      className="absolute rounded-xl overflow-hidden menu-animate"
                      style={{
                        left: '100%',
                        top: 0,
                        marginLeft: '8px',
                        minWidth: '160px',
                        background: t.settingsBg,
                        backdropFilter: 'blur(16px)',
                        border: `1px solid ${t.headerBorder}`,
                        boxShadow: t.inputShadow,
                        zIndex: 10000,
                      }}
                    >
                      <div className="px-4 py-3 text-xs" style={{ color: t.settingsSubText }}>
                        {item.title} · 开发中
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          <div className="flex-1" />

          {/* ⚙ 工具：复制自侧边栏「⚙ 工具」（外观/对话/高级三组），移动端沿用原处不动，
              这里只服务桌面端 dock；两处控件同源同 state（含 hoveredGroup），改一处记得同步改另一处 */}
          <div className="relative">
            <button
              onClick={() => setDockPanel('tools')}
              className="w-9 h-9 flex items-center justify-center rounded-lg transition-colors"
              style={{
                color: dockPanel === 'tools' ? t.headerText : t.buttonText,
                background: dockPanel === 'tools' ? t.userBubble : 'transparent',
              }}
              onMouseEnter={e => { if (dockPanel !== 'tools') e.currentTarget.style.color = t.buttonHover }}
              onMouseLeave={e => { if (dockPanel !== 'tools') e.currentTarget.style.color = t.buttonText }}
              title="工具"
            >
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
              </svg>
            </button>
            {dockPanel === 'tools' && (
              <div
                className="absolute rounded-xl overflow-hidden menu-animate"
                style={{
                  left: '100%',
                  bottom: 0,
                  marginLeft: '8px',
                  minWidth: '200px',
                  background: t.settingsBg,
                  backdropFilter: 'blur(16px)',
                  border: `1px solid ${t.headerBorder}`,
                  boxShadow: t.inputShadow,
                  zIndex: 10000,
                }}
              >
                {/* 🎨 外观 */}
                <div
                  className="relative"
                  style={{ borderBottom: `1px solid ${t.headerBorder}` }}
                  onMouseEnter={() => { if (!isMobile) setHoveredGroup('appearance') }}
                  onMouseLeave={() => { if (!isMobile) setHoveredGroup(null) }}
                >
                  <button
                    onClick={() => { if (isMobile) setHoveredGroup(prev => prev === 'appearance' ? null : 'appearance') }}
                    className="w-full flex items-center justify-between px-4 py-2.5 text-xs font-semibold transition-opacity hover:opacity-70 rounded-t-xl"
                    style={{ color: t.settingsSubText }}
                  >
                    <span>🎨 外观</span>
                    <span style={{ fontSize: '10px' }}>▸</span>
                  </button>
                  {hoveredGroup === 'appearance' && (() => {
                    const menu = (
                    <div
                      ref={submenuPortalRef}
                      className="absolute rounded-xl overflow-hidden"
                      style={{
                        ...(isMobile
                          ? { position: 'fixed', left: 12, top: 'auto', bottom: 72, maxWidth: 'calc(82vw - 24px)', maxHeight: 'calc(100vh - 140px)', overflowY: 'auto', zIndex: 10000 }
                          : { left: '100%', bottom: 0 }),
                        minWidth: '160px',
                        background: t.settingsBg,
                        backdropFilter: 'blur(16px)',
                        border: `1px solid ${t.headerBorder}`,
                        boxShadow: t.inputShadow,
                      }}
                    >
                      {isMobile && <MobileGroupTabs theme={t} active={hoveredGroup} onSelect={setHoveredGroup} />}
                      <button
                        onClick={cycleTheme}
                        className="w-full text-left px-4 py-2.5 text-xs font-medium transition-opacity hover:opacity-70"
                        style={{ color: t.settingsText }}
                      >
                        主题：{t.name}
                      </button>
                    </div>
                    )
                    return isMobile && typeof document !== 'undefined' ? createPortal(menu, document.body) : menu
                  })()}
                </div>

                {/* 💬 对话 */}
                <div
                  className="relative"
                  style={{ borderBottom: `1px solid ${t.headerBorder}` }}
                  onMouseEnter={() => { if (!isMobile) setHoveredGroup('chat') }}
                  onMouseLeave={() => { if (!isMobile) setHoveredGroup(null) }}
                >
                  <button
                    onClick={() => { if (isMobile) setHoveredGroup(prev => prev === 'chat' ? null : 'chat') }}
                    className="w-full flex items-center justify-between px-4 py-2.5 text-xs font-semibold transition-opacity hover:opacity-70"
                    style={{ color: t.settingsSubText }}
                  >
                    <span>💬 对话</span>
                    <span style={{ fontSize: '10px' }}>▸</span>
                  </button>
                  {hoveredGroup === 'chat' && (() => {
                    const menu = (
                    <div
                      ref={submenuPortalRef}
                      className="absolute rounded-xl overflow-hidden"
                      style={{
                        ...(isMobile
                          ? { position: 'fixed', left: 12, top: 'auto', bottom: 72, maxWidth: 'calc(82vw - 24px)', maxHeight: 'calc(100vh - 140px)', overflowY: 'auto', zIndex: 10000 }
                          : { left: '100%', bottom: 0 }),
                        minWidth: '160px',
                        background: t.settingsBg,
                        backdropFilter: 'blur(16px)',
                        border: `1px solid ${t.headerBorder}`,
                        boxShadow: t.inputShadow,
                      }}
                    >
                      {isMobile && <MobileGroupTabs theme={t} active={hoveredGroup} onSelect={setHoveredGroup} />}
                      <button
                        onClick={() => openSettings()}
                        className="w-full text-left px-4 py-2.5 text-xs font-medium transition-opacity hover:opacity-70"
                        style={{ color: t.settingsText, borderBottom: `1px solid ${t.headerBorder}` }}
                      >
                        System Prompt 设置
                      </button>
                      <button
                        onClick={() => {
                          const next = !thinkingEnabled
                          setThinkingEnabled(next)
                          localStorage.setItem('thinking-enabled', next ? 'true' : 'false')
                          setShowMenu(false)
                        }}
                        className="w-full text-left px-4 py-2.5 text-xs font-medium transition-opacity hover:opacity-70"
                        style={{ color: t.settingsText, borderBottom: thinkingEnabled ? `1px solid ${t.headerBorder}` : undefined }}
                      >
                        心声模式：{thinkingEnabled ? '开启 ✓' : '关闭'}
                      </button>
                      {thinkingEnabled && (
                        <button
                          onClick={() => {
                            const next = thinkingMode === 'short' ? 'long' : 'short'
                            setThinkingMode(next)
                            localStorage.setItem('thinking-mode', next)
                            setShowMenu(false)
                          }}
                          className="w-full text-left px-4 py-2.5 text-xs font-medium transition-opacity hover:opacity-70"
                          style={{ color: t.settingsText }}
                        >
                          心声深度：{thinkingMode === 'short' ? '简短' : '详细'}
                        </button>
                      )}
                    </div>
                    )
                    return isMobile && typeof document !== 'undefined' ? createPortal(menu, document.body) : menu
                  })()}
                </div>

                {/* ⚙️ 高级 */}
                <div
                  className="relative"
                  onMouseEnter={() => { if (!isMobile) setHoveredGroup('advanced') }}
                  onMouseLeave={() => { if (!isMobile) setHoveredGroup(null) }}
                >
                  <button
                    onClick={() => { if (isMobile) setHoveredGroup(prev => prev === 'advanced' ? null : 'advanced') }}
                    className="w-full flex items-center justify-between px-4 py-2.5 text-xs font-semibold transition-opacity hover:opacity-70 rounded-b-xl"
                    style={{ color: t.settingsSubText }}
                  >
                    <span>⚙️ 高级</span>
                    <span style={{ fontSize: '10px' }}>▸</span>
                  </button>
                  {hoveredGroup === 'advanced' && (() => {
                    const menu = (
                    <div
                      ref={submenuPortalRef}
                      className="absolute rounded-xl overflow-hidden"
                      style={{
                        ...(isMobile
                          ? { position: 'fixed', left: 12, top: 'auto', bottom: 72, maxWidth: 'calc(82vw - 24px)', maxHeight: 'calc(100vh - 140px)', overflowY: 'auto', zIndex: 10000 }
                          : { left: '100%', bottom: 0 }),
                        minWidth: '160px',
                        background: t.settingsBg,
                        backdropFilter: 'blur(16px)',
                        border: `1px solid ${t.headerBorder}`,
                        boxShadow: t.inputShadow,
                      }}
                    >
                      {isMobile && <MobileGroupTabs theme={t} active={hoveredGroup} onSelect={setHoveredGroup} />}
                      <button
                        onClick={() => { setApiDraft({ ...DEFAULT_API_DRAFT }); setApiTestStatus('idle'); setModelList([]); setShowApiSettings(true); setShowMenu(false) }}
                        className="w-full text-left px-4 py-2.5 text-xs font-medium transition-opacity hover:opacity-70"
                        style={{ color: t.settingsText, borderBottom: `1px solid ${t.headerBorder}` }}
                      >
                        API 设置{activeConfigName ? ` · ${activeConfigName}` : ''}
                      </button>
                      <button
                        onClick={() => { router.push('/memories'); setShowMenu(false) }}
                        className="w-full text-left px-4 py-2.5 text-xs font-medium transition-opacity hover:opacity-70"
                        style={{ color: t.settingsText, borderBottom: `1px solid ${t.headerBorder}` }}
                      >
                        记忆管理
                      </button>
                      <button
                        onClick={() => { setDevPasswordMode('verify'); setDevPasswordInput(''); setDevPasswordError(''); setShowDevPasswordDialog(true) }}
                        className="w-full text-left px-4 py-2.5 text-xs font-medium transition-opacity hover:opacity-70"
                        style={{ color: t.settingsText, borderBottom: devMode ? `1px solid ${t.headerBorder}` : undefined }}
                      >
                        开发者模式：{devMode ? '开启 ✓' : '关闭'}
                      </button>
                      {devMode && (
                        <button
                          onClick={() => { setDevPasswordMode('change'); setDevPasswordInput(''); setDevPasswordError(''); setShowDevPasswordDialog(true); setShowMenu(false) }}
                          className="w-full text-left px-4 py-2.5 text-xs font-medium transition-opacity hover:opacity-70"
                          style={{ color: t.settingsText }}
                        >
                          修改密码
                        </button>
                      )}
                    </div>
                    )
                    return isMobile && typeof document !== 'undefined' ? createPortal(menu, document.body) : menu
                  })()}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* 移动端遮罩 */}
        {isMobile && sidebarOpen && (
          <div
            className="fixed inset-0"
            style={{ background: 'rgba(0,0,0,0.35)', zIndex: 39 }}
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {/* 侧边栏 */}
        <div
          className={`sidebar-container${sidebarOpen ? ' sidebar-open' : ' sidebar-closed'}`}
          style={{
            background: t.headerBg,
            backdropFilter: 'blur(12px)',
            borderRight: `1px solid ${t.headerBorder}`,
          }}
        >
            {/* ── 每日信息 + 空间入口 ── */}
            <div className="px-3 pt-3 pb-2 shrink-0" style={{ borderBottom: `1px solid ${t.headerBorder}` }}>
              {/* 每日信息卡片 */}
              <div
                className="rounded-xl px-3 py-2.5 mb-2"
                style={{ background: t.settingsInputBg, border: `1px solid ${t.settingsInputBorder}` }}
              >
                {sidebarWeather ? (
                  <div className="flex items-baseline gap-2 mb-1.5">
                    <span className="text-sm font-semibold" style={{ color: t.settingsText }}>{sidebarWeather.temp}°C</span>
                    <span className="text-xs" style={{ color: t.settingsSubText }}>{getClothingAdvice(sidebarWeather.temp)}</span>
                  </div>
                ) : (
                  <div className="text-xs mb-1.5" style={{ color: t.settingsSubText }}>天气加载中…</div>
                )}
                <div className="text-xs leading-relaxed" style={{ color: t.settingsSubText }}>
                  {dailyQuote || '…'}
                </div>
              </div>
              {/* 分割线 */}
              <div style={{ borderTop: `1px solid ${t.headerBorder}`, margin: '6px 0' }} />
              {/* 空间入口（仅移动端；桌面端已迁到左侧 dock「空间」图标） */}
              {isMobile && (
              <button
                className="w-full flex items-center justify-between px-1 py-1 rounded-lg transition-opacity hover:opacity-70"
                onClick={() => { setViewingSpace(true); setViewingPersona(null); closeSidebarOnMobile() }}
                style={{ background: viewingSpace ? t.userBubble : 'transparent' }}
              >
                <span className="text-base font-semibold" style={{ color: viewingSpace ? t.headerText : t.settingsSubText }}>空间</span>
                <span className="text-sm font-semibold" style={{ color: t.settingsSubText }}>›</span>
              </button>
              )}
            </div>

            <div className="flex-1 overflow-y-auto py-2">
              {/* 好友分组标题 */}
              <div className="px-4 pt-2 pb-1">
                <span className="text-base font-semibold" style={{ color: t.settingsSubText }}>好友</span>
              </div>
              {allPersonas.map(persona => {
                const group = conversations
                  .filter(c => persona.id === 'default'
                    ? !c.personaId || c.personaId === 'default'
                    : c.personaId === persona.id
                  )
                  .sort((a, b) => b.updatedAt - a.updatedAt)
                const isCollapsed = collapsedPersonas.has(persona.id)
                return (
                  <div key={persona.id} className="mb-2">
                    {/* 角色分组标题行 */}
                    <div className="flex items-center gap-1 px-3 py-2">
                      <button
                        className="flex items-center gap-2 flex-1 min-w-0 transition-opacity hover:opacity-70"
                        onClick={() => { setViewingPersona(persona); setViewingSpace(false); closeSidebarOnMobile() }}
                      >
                        <div className="w-2 h-2 rounded-full shrink-0" style={{ background: persona.color }} />
                        <span className="text-sm font-semibold flex-1 text-left truncate" style={{ color: t.headerText }}>{persona.name}</span>
                      </button>
                      <button
                        className="shrink-0 w-8 h-8 flex items-center justify-center rounded-md transition-opacity hover:opacity-70 text-base font-semibold"
                        style={{ color: t.settingsSubText }}
                        onClick={() => { newConversationForPersona(persona.id); closeSidebarOnMobile() }}
                        title={`新建 ${persona.name} 对话`}
                      >
                        +
                      </button>
                      <button
                        className="shrink-0 w-8 h-8 flex items-center justify-center transition-opacity hover:opacity-70"
                        onClick={() => togglePersonaCollapse(persona.id)}
                        title={isCollapsed ? '展开' : '折叠'}
                      >
                        <span className="text-sm font-semibold" style={{ color: t.settingsSubText }}>{isCollapsed ? '▸' : '▾'}</span>
                      </button>
                    </div>
                    {!isCollapsed && (
                      <div className="pb-1">
                        {group.map(c => (
                          <div
                            key={c.id}
                            className="sidebar-item flex items-center justify-between px-3 py-2.5 mx-2 rounded-lg cursor-pointer"
                            style={{
                              background: c.id === currentId ? t.userBubble : 'transparent',
                              transition: 'background 0.15s ease',
                            }}
                            onClick={() => { if (editingId !== c.id) { switchConversation(c.id); closeSidebarOnMobile() } }}
                          >
                            {editingId === c.id ? (
                              <input
                                ref={editInputRef}
                                className="flex-1 text-sm bg-transparent outline-none border-b"
                                style={{ color: t.headerText, borderColor: t.headerBorder }}
                                value={editingTitle}
                                onChange={e => setEditingTitle(e.target.value)}
                                onBlur={saveTitle}
                                onKeyDown={e => {
                                  if (e.key === 'Enter') saveTitle()
                                  if (e.key === 'Escape') setEditingId(null)
                                }}
                                onClick={e => e.stopPropagation()}
                              />
                            ) : (
                              <span
                                className="text-sm truncate flex-1"
                                style={{ color: c.id === currentId ? t.headerText : t.buttonText }}
                                onDoubleClick={e => { e.stopPropagation(); startEditing(c.id, c.title) }}
                              >
                                {c.title}
                              </span>
                            )}
                            <button
                              className="delete-btn text-sm ml-2 opacity-0 transition-opacity shrink-0"
                              style={{ color: t.buttonText }}
                              onClick={e => { e.stopPropagation(); setPendingDeleteId(c.id) }}
                            >
                              ×
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            {/* ⚙ 工具（仅移动端；桌面端已迁到左侧 dock「⚙ 工具」图标，
                外观/对话/高级三组同源同 state 在两处各有一份，改一处记得同步改另一处） */}
            {isMobile && (
            <div
              className="px-3 py-3 relative"
              style={{ borderTop: `1px solid ${t.headerBorder}` }}
              ref={menuRef}
            >
              {showMenu && (
                <div
                  className="absolute bottom-14 left-3 right-3 rounded-xl menu-animate"
                  style={{
                    background: t.settingsBg,
                    backdropFilter: 'blur(16px)',
                    border: `1px solid ${t.headerBorder}`,
                    boxShadow: t.inputShadow,
                    zIndex: 9999,
                    ...(isMobile ? { maxHeight: 'calc(100vh - 140px)', overflowY: 'auto' } : {}),
                  }}
                >
                  {/* 🎨 外观 */}
                  <div
                    className="relative"
                    style={{ borderBottom: `1px solid ${t.headerBorder}` }}
                    onMouseEnter={() => { if (!isMobile) setHoveredGroup('appearance') }}
                    onMouseLeave={() => { if (!isMobile) setHoveredGroup(null) }}
                  >
                    <button
                      onClick={() => { if (isMobile) setHoveredGroup(prev => prev === 'appearance' ? null : 'appearance') }}
                      className="w-full flex items-center justify-between px-4 py-2.5 text-xs font-semibold transition-opacity hover:opacity-70 rounded-t-xl"
                      style={{ color: t.settingsSubText }}
                    >
                      <span>🎨 外观</span>
                      <span style={{ fontSize: '10px' }}>▸</span>
                    </button>
                    {hoveredGroup === 'appearance' && (() => {
                      const menu = (
                      <div
                        ref={submenuPortalRef}
                        className="absolute rounded-xl overflow-hidden"
                        style={{
                          ...(isMobile
                            ? { position: 'fixed', left: 12, top: 'auto', bottom: 72, maxWidth: 'calc(82vw - 24px)', maxHeight: 'calc(100vh - 140px)', overflowY: 'auto', zIndex: 10000 }
                            : { left: '100%', bottom: 0 }),
                          minWidth: '160px',
                          background: t.settingsBg,
                          backdropFilter: 'blur(16px)',
                          border: `1px solid ${t.headerBorder}`,
                          boxShadow: t.inputShadow,
                        }}
                      >
                        {isMobile && <MobileGroupTabs theme={t} active={hoveredGroup} onSelect={setHoveredGroup} />}
                        <button
                          onClick={cycleTheme}
                          className="w-full text-left px-4 py-2.5 text-xs font-medium transition-opacity hover:opacity-70"
                          style={{ color: t.settingsText }}
                        >
                          主题：{t.name}
                        </button>
                      </div>
                      )
                      return isMobile && typeof document !== 'undefined' ? createPortal(menu, document.body) : menu
                    })()}
                  </div>

                  {/* 💬 对话 */}
                  <div
                    className="relative"
                    style={{ borderBottom: `1px solid ${t.headerBorder}` }}
                    onMouseEnter={() => { if (!isMobile) setHoveredGroup('chat') }}
                    onMouseLeave={() => { if (!isMobile) setHoveredGroup(null) }}
                  >
                    <button
                      onClick={() => { if (isMobile) setHoveredGroup(prev => prev === 'chat' ? null : 'chat') }}
                      className="w-full flex items-center justify-between px-4 py-2.5 text-xs font-semibold transition-opacity hover:opacity-70"
                      style={{ color: t.settingsSubText }}
                    >
                      <span>💬 对话</span>
                      <span style={{ fontSize: '10px' }}>▸</span>
                    </button>
                    {hoveredGroup === 'chat' && (() => {
                      const menu = (
                      <div
                        ref={submenuPortalRef}
                        className="absolute rounded-xl overflow-hidden"
                        style={{
                          ...(isMobile
                            ? { position: 'fixed', left: 12, top: 'auto', bottom: 72, maxWidth: 'calc(82vw - 24px)', maxHeight: 'calc(100vh - 140px)', overflowY: 'auto', zIndex: 10000 }
                            : { left: '100%', bottom: 0 }),
                          minWidth: '160px',
                          background: t.settingsBg,
                          backdropFilter: 'blur(16px)',
                          border: `1px solid ${t.headerBorder}`,
                          boxShadow: t.inputShadow,
                        }}
                      >
                        {isMobile && <MobileGroupTabs theme={t} active={hoveredGroup} onSelect={setHoveredGroup} />}
                        <button
                          onClick={() => openSettings()}
                          className="w-full text-left px-4 py-2.5 text-xs font-medium transition-opacity hover:opacity-70"
                          style={{ color: t.settingsText, borderBottom: `1px solid ${t.headerBorder}` }}
                        >
                          System Prompt 设置
                        </button>
                        <button
                          onClick={() => {
                            const next = !thinkingEnabled
                            setThinkingEnabled(next)
                            localStorage.setItem('thinking-enabled', next ? 'true' : 'false')
                            setShowMenu(false)
                          }}
                          className="w-full text-left px-4 py-2.5 text-xs font-medium transition-opacity hover:opacity-70"
                          style={{ color: t.settingsText, borderBottom: thinkingEnabled ? `1px solid ${t.headerBorder}` : undefined }}
                        >
                          心声模式：{thinkingEnabled ? '开启 ✓' : '关闭'}
                        </button>
                        {thinkingEnabled && (
                          <button
                            onClick={() => {
                              const next = thinkingMode === 'short' ? 'long' : 'short'
                              setThinkingMode(next)
                              localStorage.setItem('thinking-mode', next)
                              setShowMenu(false)
                            }}
                            className="w-full text-left px-4 py-2.5 text-xs font-medium transition-opacity hover:opacity-70"
                            style={{ color: t.settingsText }}
                          >
                            心声深度：{thinkingMode === 'short' ? '简短' : '详细'}
                          </button>
                        )}
                      </div>
                      )
                      return isMobile && typeof document !== 'undefined' ? createPortal(menu, document.body) : menu
                    })()}
                  </div>

                  {/* 🔊 音效（仅移动端；桌面端已迁到左侧 dock「🎵 音乐台」面板，
                      两处控件同源同 state，改这里记得同步改那份，避免两边行为不一致） */}
                  {isMobile && (
                  <div
                    className="relative"
                    style={{ borderBottom: `1px solid ${t.headerBorder}` }}
                    onMouseEnter={() => { if (!isMobile) setHoveredGroup('audio') }}
                    onMouseLeave={() => { if (!isMobile) setHoveredGroup(null) }}
                  >
                    <button
                      onClick={() => { if (isMobile) setHoveredGroup(prev => prev === 'audio' ? null : 'audio') }}
                      className="w-full flex items-center justify-between px-4 py-2.5 text-xs font-semibold transition-opacity hover:opacity-70"
                      style={{ color: t.settingsSubText }}
                    >
                      <span>🔊 音效</span>
                      <span style={{ fontSize: '10px' }}>▸</span>
                    </button>
                    {hoveredGroup === 'audio' && (() => {
                      const menu = (
                      <div
                        ref={submenuPortalRef}
                        className="absolute rounded-xl overflow-hidden"
                        style={{
                          ...(isMobile
                            ? { position: 'fixed', left: 12, top: 'auto', bottom: 72, maxWidth: 'calc(82vw - 24px)', maxHeight: 'calc(100vh - 140px)', overflowY: 'auto', zIndex: 10000 }
                            : { left: '100%', bottom: 0 }),
                          minWidth: '220px',
                          background: t.settingsBg,
                          backdropFilter: 'blur(16px)',
                          border: `1px solid ${t.headerBorder}`,
                          boxShadow: t.inputShadow,
                        }}
                      >
                        {isMobile && <MobileGroupTabs theme={t} active={hoveredGroup} onSelect={setHoveredGroup} />}
                        <button
                          onClick={() => { setTtsAutoPlay(prev => !prev); setShowMenu(false) }}
                          className="w-full text-left px-4 py-2.5 text-xs font-medium transition-opacity hover:opacity-70"
                          style={{ color: t.settingsText, borderBottom: `1px solid ${t.headerBorder}` }}
                        >
                          自动朗读：{ttsAutoPlay ? '开启 ✓' : '关闭'}
                        </button>
                        <div className="px-4 py-2.5 flex items-center gap-2" style={{ borderBottom: `1px solid ${t.headerBorder}` }}>
                          <span className="text-xs shrink-0" style={{ color: t.settingsSubText }}>环境音</span>
                          {[
                            { key: 'rain', label: '雨' },
                            { key: 'forest', label: '林' },
                            { key: 'water', label: '水' },
                          ].map(({ key, label }) => (
                            <button
                              key={key}
                              onClick={() => setAmbientSound(prev => prev === key ? null : key)}
                              className="rounded-md px-2 py-0.5 text-xs transition-all"
                              style={{
                                color: ambientSound === key ? t.headerText : t.settingsSubText,
                                background: ambientSound === key ? t.userBubble : 'transparent',
                                opacity: ambientSound === key ? 1 : 0.6,
                              }}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                        <div className="px-4 py-2.5" style={{ borderBottom: `1px solid ${t.headerBorder}` }}>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs" style={{ color: t.settingsSubText }}>语音音量</span>
                            <span className="text-xs" style={{ color: t.settingsText }}>{Math.round(ttsVolume * 100)}%</span>
                          </div>
                          <input type="range" min="0" max="1" step="0.05" value={ttsVolume}
                            onChange={e => setTtsVolume(parseFloat(e.target.value))}
                            style={{ width: '100%', accentColor: t.sendButton }} />
                        </div>
                        <div className="px-4 py-2.5" style={{ borderBottom: `1px solid ${t.headerBorder}` }}>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs" style={{ color: t.settingsSubText }}>环境音量</span>
                            <span className="text-xs" style={{ color: t.settingsText }}>{Math.round(ambientVolume * 100)}%</span>
                          </div>
                          <input type="range" min="0" max="1" step="0.05" value={ambientVolume}
                            onChange={e => setAmbientVolume(parseFloat(e.target.value))}
                            style={{ width: '100%', accentColor: t.sendButton }} />
                        </div>
                        <div className="px-4 py-2.5">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs" style={{ color: t.settingsSubText }}>语速</span>
                            <div className="flex items-center gap-2">
                              <span className="text-xs" style={{ color: t.settingsText }}>{ttsSpeed.toFixed(1)}x</span>
                              <button
                                onClick={async () => {
                                  const personaId = currentConversation?.personaId ?? 'default'
                                  const voice = getPersonaById(personaId)?.voice_id ?? 'male-qn-qingse'
                                  const sample = '今天天气真不错，适合出门走走。'
                                  try {
                                    const res = await fetch('/api/tts', {
                                      method: 'POST',
                                      headers: { 'Content-Type': 'application/json' },
                                      body: JSON.stringify({ text: sample, voice, speed: ttsSpeed * (intimateMode ? 0.8 : 1.0) }),
                                    })
                                    if (!res.ok) return
                                    const blob = await res.blob()
                                    const url = URL.createObjectURL(blob)
                                    const audio = new Audio(url)
                                    audio.volume = ttsVolume
                                    audio.onended = () => URL.revokeObjectURL(url)
                                    safePlayAudio(audio)
                                  } catch {}
                                }}
                                className="text-xs px-1.5 py-0.5 rounded-md transition-opacity hover:opacity-70"
                                style={{ color: t.settingsSubText, border: `1px solid ${t.headerBorder}` }}
                              >
                                试听
                              </button>
                            </div>
                          </div>
                          <input type="range" min="0.5" max="1.5" step="0.1" value={ttsSpeed}
                            onChange={e => setTtsSpeed(parseFloat(e.target.value))}
                            style={{ width: '100%', accentColor: t.sendButton }} />
                        </div>
                      </div>
                      )
                      return isMobile && typeof document !== 'undefined' ? createPortal(menu, document.body) : menu
                    })()}
                  </div>
                  )}

                  {/* ⚙️ 高级 */}
                  <div
                    className="relative"
                    onMouseEnter={() => { if (!isMobile) setHoveredGroup('advanced') }}
                    onMouseLeave={() => { if (!isMobile) setHoveredGroup(null) }}
                  >
                    <button
                      onClick={() => { if (isMobile) setHoveredGroup(prev => prev === 'advanced' ? null : 'advanced') }}
                      className="w-full flex items-center justify-between px-4 py-2.5 text-xs font-semibold transition-opacity hover:opacity-70 rounded-b-xl"
                      style={{ color: t.settingsSubText }}
                    >
                      <span>⚙️ 高级</span>
                      <span style={{ fontSize: '10px' }}>▸</span>
                    </button>
                    {hoveredGroup === 'advanced' && (() => {
                      const menu = (
                      <div
                        ref={submenuPortalRef}
                        className="absolute rounded-xl overflow-hidden"
                        style={{
                          ...(isMobile
                            ? { position: 'fixed', left: 12, top: 'auto', bottom: 72, maxWidth: 'calc(82vw - 24px)', maxHeight: 'calc(100vh - 140px)', overflowY: 'auto', zIndex: 10000 }
                            : { left: '100%', bottom: 0 }),
                          minWidth: '160px',
                          background: t.settingsBg,
                          backdropFilter: 'blur(16px)',
                          border: `1px solid ${t.headerBorder}`,
                          boxShadow: t.inputShadow,
                        }}
                      >
                        {isMobile && <MobileGroupTabs theme={t} active={hoveredGroup} onSelect={setHoveredGroup} />}
                        <button
                          onClick={() => { setApiDraft({ ...DEFAULT_API_DRAFT }); setApiTestStatus('idle'); setModelList([]); setShowApiSettings(true); setShowMenu(false) }}
                          className="w-full text-left px-4 py-2.5 text-xs font-medium transition-opacity hover:opacity-70"
                          style={{ color: t.settingsText, borderBottom: `1px solid ${t.headerBorder}` }}
                        >
                          API 设置{activeConfigName ? ` · ${activeConfigName}` : ''}
                        </button>
                        <button
                          onClick={() => { router.push('/memories'); setShowMenu(false) }}
                          className="w-full text-left px-4 py-2.5 text-xs font-medium transition-opacity hover:opacity-70"
                          style={{ color: t.settingsText, borderBottom: `1px solid ${t.headerBorder}` }}
                        >
                          记忆管理
                        </button>
                        <button
                          onClick={() => { setDevPasswordMode('verify'); setDevPasswordInput(''); setDevPasswordError(''); setShowDevPasswordDialog(true) }}
                          className="w-full text-left px-4 py-2.5 text-xs font-medium transition-opacity hover:opacity-70"
                          style={{ color: t.settingsText, borderBottom: devMode ? `1px solid ${t.headerBorder}` : undefined }}
                        >
                          开发者模式：{devMode ? '开启 ✓' : '关闭'}
                        </button>
                        {devMode && (
                          <button
                            onClick={() => { setDevPasswordMode('change'); setDevPasswordInput(''); setDevPasswordError(''); setShowDevPasswordDialog(true); setShowMenu(false) }}
                            className="w-full text-left px-4 py-2.5 text-xs font-medium transition-opacity hover:opacity-70"
                            style={{ color: t.settingsText }}
                          >
                            修改密码
                          </button>
                        )}
                      </div>
                      )
                      return isMobile && typeof document !== 'undefined' ? createPortal(menu, document.body) : menu
                    })()}
                  </div>
                </div>
              )}

              <button
                onClick={() => setShowMenu(p => !p)}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium transition-opacity hover:opacity-70"
                style={{
                  background: showMenu ? t.userBubble : 'transparent',
                  color: t.buttonText,
                  border: `1px solid ${showMenu ? t.userBubbleBorder : 'transparent'}`,
                }}
              >
                <span>⚙</span>
                <span>工具</span>
              </button>
            </div>
            )}
          </div>

        {/* 主区域 */}
        <div className="flex flex-col flex-1 min-w-0">
          <div
            className="flex items-center gap-3 px-4 py-3 shrink-0"
            style={{
              borderBottom: `1px solid ${t.headerBorder}`,
              background: t.headerBg,
              backdropFilter: 'blur(12px)',
              position: 'sticky',
              top: 0,
              zIndex: 50,
            }}
          >
            <button
              onClick={() => setSidebarOpen(p => !p)}
              className="text-xs transition-colors shrink-0"
              style={{ color: t.buttonText }}
              onMouseEnter={e => (e.currentTarget.style.color = t.buttonHover)}
              onMouseLeave={e => (e.currentTarget.style.color = t.buttonText)}
            >
              ☰
            </button>
            <span className="text-xl font-semibold flex-1 text-center" style={{ color: t.headerText }}>
              {(() => {
                if (viewingSpace) return '动态'
                if (viewingPersona) return viewingPersona.name
                const pid = currentConversation?.personaId ?? 'default'
                if (pid === 'default') return 'Claude'
                return getPersonaById(pid)?.name ?? 'Claude'
              })()}
            </span>
            <button
              onClick={() => {
                setIntimateMode(prev => !prev)
                ttsCache.current = {}
              }}
              className="shrink-0 w-7 h-7 flex items-center justify-center rounded-lg transition-colors"
              style={{
                color: intimateMode ? '#e8a87c' : t.buttonText,
                background: intimateMode ? 'rgba(232,168,124,0.12)' : 'transparent',
              }}
              title="缠绵模式"
            >
              <span style={{ fontSize: '15px', lineHeight: 1 }}>{intimateMode ? '🌙' : '☽'}</span>
            </button>
            {/* 返回首页：仅移动端；桌面端已迁到左侧 dock 顶部 */}
            {isMobile && (
            <button
              onClick={handleGoHome}
              className="shrink-0 w-7 h-7 flex items-center justify-center rounded-lg transition-colors"
              style={{ color: t.buttonText }}
              onMouseEnter={e => (e.currentTarget.style.color = t.buttonHover)}
              onMouseLeave={e => (e.currentTarget.style.color = t.buttonText)}
              title="返回首页"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>
                <polyline points="9 22 9 12 15 12 15 22"/>
              </svg>
            </button>
            )}
          </div>

          {viewingSpace ? (
            /* ===== 空间动态页 ===== */
            <div className="flex-1 overflow-y-auto px-4 py-6">
              <div className="max-w-xl mx-auto flex flex-col gap-4">
                {/* 发布输入框 */}
                <div
                  className="rounded-2xl px-4 py-3"
                  style={{ background: t.inputBg, backdropFilter: 'blur(12px)', border: `1px solid ${t.inputBorder}`, boxShadow: t.inputShadow }}
                >
                  {/* 可见范围循环切换 */}
                  <div className="flex items-center gap-2 pb-2.5 mb-2.5" style={{ borderBottom: `1px solid ${t.settingsInputBorder}` }}>
                    <span className="text-xs font-medium shrink-0" style={{ color: t.settingsSubText }}>发给</span>
                    <button
                      className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs transition-opacity hover:opacity-70"
                      style={{ background: t.settingsInputBg, color: t.settingsText, border: `1px solid ${t.settingsInputBorder}` }}
                      onClick={cycleSpaceVisibility}
                    >
                      {spaceVisiblePersonaId === null ? (
                        <>
                          {spacePersonas.map(p => <div key={p.id} className="w-2 h-2 rounded-full" style={{ background: p.color }} />)}
                          <span>全部可见</span>
                        </>
                      ) : (
                        <>
                          <div className="w-2 h-2 rounded-full" style={{ background: spacePersonas.find(p => p.id === spaceVisiblePersonaId)?.color }} />
                          <span>仅 {spacePersonas.find(p => p.id === spaceVisiblePersonaId)?.name} 可见</span>
                        </>
                      )}
                      <span style={{ opacity: 0.5 }}>⇌</span>
                    </button>
                  </div>
                  <div className="flex items-end gap-2">
                    <textarea
                      ref={composeRef}
                      className="flex-1 bg-transparent resize-none outline-none text-sm"
                      style={{ color: t.inputText, maxHeight: '160px', overflowY: 'auto' }}
                      placeholder="有什么想说的…"
                      rows={1}
                      value={draftContent}
                      onChange={e => {
                        setDraftContent(e.target.value)
                        e.target.style.height = 'auto'
                        e.target.style.height = `${e.target.scrollHeight}px`
                      }}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); publishPost() }
                      }}
                    />
                    <button
                      onClick={publishPost}
                      disabled={!draftContent.trim()}
                      className="transition-opacity disabled:opacity-30 shrink-0"
                      style={{ color: t.sendButton, fontSize: '18px', lineHeight: 1 }}
                    >↑</button>
                  </div>
                </div>
                <p className="text-center text-xs -mt-2" style={{ color: t.footerText }}>按 Enter 发布，Shift+Enter 换行</p>

                {/* 动态列表 */}
                {posts.length === 0 ? (
                  <div className="flex items-center justify-center py-20">
                    <span className="text-sm" style={{ color: t.settingsSubText }}>还没有动态，写点什么吧</span>
                  </div>
                ) : posts.map(post => {
                  const visiblePersonas = spacePersonas.filter(p => post.visibleTo.includes(p.id))
                  const isGenerating = generatingFor.has(post.id)
                  return (
                    <div key={post.id} className="rounded-2xl p-4" style={{ background: t.settingsBg, backdropFilter: 'blur(16px)', border: `1px solid ${t.headerBorder}` }}>
                      <p className="text-sm leading-relaxed whitespace-pre-wrap mb-3" style={{ color: t.settingsText }}>{post.content}</p>
                      <div className="flex items-center gap-3 mb-3">
                        <span className="text-xs" style={{ color: t.settingsSubText }}>{formatPostTime(post.createdAt)}</span>
                        {visiblePersonas.length > 0 && (
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs" style={{ color: t.settingsSubText }}>对</span>
                            {visiblePersonas.map(p => <div key={p.id} className="w-2 h-2 rounded-full" title={p.name} style={{ background: p.color }} />)}
                            <span className="text-xs" style={{ color: t.settingsSubText }}>{visiblePersonas.map(p => p.name).join('、')} 可见</span>
                          </div>
                        )}
                      </div>
                      <div style={{ borderTop: `1px solid ${t.settingsInputBorder}`, paddingTop: '12px' }}>
                        {post.comments.length === 0 && !isGenerating && (
                          <span className="text-xs" style={{ color: t.settingsSubText }}>暂无评论</span>
                        )}
                        {post.comments.map((c, i) => {
                          const persona = allPersonas.find(p => p.id === c.personaId)
                          const userReplyCount = (c.replies ?? []).filter(r => r.author === 'user').length
                          const canReply = userReplyCount < 2
                          const isReplying = replyingTo?.postId === post.id && replyingTo?.commentIdx === i
                          const replyKey = `${post.id}-${i}`
                          const isGeneratingReply = generatingReplyFor.has(replyKey)
                          return (
                            <div key={i} className="flex gap-2.5 mb-3 last:mb-0">
                              <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 mt-0.5" style={{ background: persona?.color ?? '#999', color: '#fff' }}>
                                {persona?.name[0] ?? '?'}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-baseline gap-2 mb-0.5">
                                  <span className="text-xs font-semibold" style={{ color: t.settingsText }}>{persona?.name ?? c.personaId}</span>
                                  <span className="text-xs" style={{ color: t.settingsSubText }}>{formatPostTime(c.createdAt)}</span>
                                </div>
                                <p className="text-sm leading-relaxed" style={{ color: t.settingsText }}>{c.content}</p>
                                {/* 嵌套回复 */}
                                {(c.replies ?? []).length > 0 && (
                                  <div className="mt-2 pl-3" style={{ borderLeft: `2px solid ${t.settingsInputBorder}` }}>
                                    {(c.replies ?? []).map((r, ri) => {
                                      const isUser = r.author === 'user'
                                      const replyPersona = isUser ? null : allPersonas.find(p => p.id === r.author)
                                      return (
                                        <div key={ri} className="mb-1.5 last:mb-0 text-xs leading-relaxed" style={{ color: t.settingsText }}>
                                          <span className="font-semibold mr-1" style={{ color: isUser ? t.userBubble : (replyPersona?.color ?? t.settingsText) }}>
                                            {isUser ? '我' : (replyPersona?.name ?? r.author)}：
                                          </span>
                                          {r.content}
                                        </div>
                                      )
                                    })}
                                    {isGeneratingReply && (
                                      <div className="flex gap-0.5 mt-1" style={{ color: t.settingsSubText }}>
                                        <span className="animate-bounce" style={{ animationDelay: '0ms' }}>·</span>
                                        <span className="animate-bounce" style={{ animationDelay: '150ms' }}>·</span>
                                        <span className="animate-bounce" style={{ animationDelay: '300ms' }}>·</span>
                                      </div>
                                    )}
                                  </div>
                                )}
                                {/* 回复按钮 / 输入框 */}
                                {!isReplying && canReply && !isGeneratingReply && (
                                  <button
                                    onClick={() => { setReplyingTo({ postId: post.id, commentIdx: i }); setReplyDraft('') }}
                                    className="mt-1.5 text-xs transition-opacity hover:opacity-70"
                                    style={{ color: t.settingsSubText }}
                                  >
                                    回复
                                  </button>
                                )}
                                {isReplying && (
                                  <div className="mt-2 flex gap-2 items-end">
                                    <textarea
                                      value={replyDraft}
                                      onChange={e => setReplyDraft(e.target.value)}
                                      placeholder="回复…"
                                      rows={1}
                                      className="flex-1 text-xs rounded-lg px-2.5 py-1.5 resize-none leading-relaxed outline-none"
                                      style={{ background: t.settingsInputBg, border: `1px solid ${t.settingsInputBorder}`, color: t.settingsText, minHeight: '30px', maxHeight: '72px' }}
                                      onKeyDown={e => {
                                        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitReply(post.id, i, c, post.content) }
                                      }}
                                    />
                                    <button
                                      onClick={() => submitReply(post.id, i, c, post.content)}
                                      className="text-xs px-2.5 py-1.5 rounded-lg font-medium shrink-0"
                                      style={{ background: t.userBubble, color: '#fff' }}
                                    >
                                      发送
                                    </button>
                                    <button
                                      onClick={() => setReplyingTo(null)}
                                      className="text-xs py-1.5 shrink-0 transition-opacity hover:opacity-70"
                                      style={{ color: t.settingsSubText }}
                                    >
                                      取消
                                    </button>
                                  </div>
                                )}
                              </div>
                            </div>
                          )
                        })}
                        {isGenerating && (
                          <div className="flex items-center gap-2 mt-2">
                            <div className="flex gap-1" style={{ color: t.settingsSubText }}>
                              <span className="animate-bounce" style={{ animationDelay: '0ms' }}>·</span>
                              <span className="animate-bounce" style={{ animationDelay: '150ms' }}>·</span>
                              <span className="animate-bounce" style={{ animationDelay: '300ms' }}>·</span>
                            </div>
                            <span className="text-xs" style={{ color: t.settingsSubText }}>
                              {spacePersonas.filter(p => post.visibleTo.includes(p.id)).filter(p => !post.comments.find(c => c.personaId === p.id)).map(p => p.name).join('、')} 正在评论
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ) : viewingPersona ? (
            /* ===== 角色资料页 ===== */
            <div className="flex-1 overflow-y-auto px-4 py-6 flex flex-col gap-4">
              {/* 个人资料卡片 */}
              <div
                className="rounded-2xl px-6 pt-6 pb-8 flex flex-col gap-5"
                style={{
                  background: t.settingsBg,
                  backdropFilter: 'blur(16px)',
                  border: `1px solid ${t.headerBorder}`,
                }}
              >
                {/* 头像 */}
                <div
                  className="w-20 h-20 rounded-full flex items-center justify-center text-3xl font-bold shadow-lg"
                  style={{ background: viewingPersona.color, color: '#fff' }}
                >
                  {viewingPersona.name[0]}
                </div>
                {/* 姓名 + 基础信息 */}
                <div>
                  <div className="text-xl font-semibold" style={{ color: t.settingsText }}>{viewingPersona.name}</div>
                  {(viewingPersona.profile?.gender || viewingPersona.profile?.age || viewingPersona.profile?.constellation) && (
                    <div className="mt-1 text-sm" style={{ color: t.settingsSubText }}>
                      {[
                        viewingPersona.profile?.gender,
                        viewingPersona.profile?.age ? `${viewingPersona.profile.age}岁` : undefined,
                        viewingPersona.profile?.constellation,
                      ].filter(Boolean).join(' · ')}
                    </div>
                  )}
                </div>
                {/* 备注 */}
                <div className="flex items-center gap-6 text-sm">
                  <span style={{ color: t.settingsSubText }}>备注</span>
                  <span style={{ color: t.settingsText }}>{viewingPersona.profile?.note ?? '慧妍'}</span>
                </div>
                {/* 分割线 */}
                <div style={{ borderTop: `1px solid ${t.settingsInputBorder}` }} />
                {/* 个性签名 */}
                {viewingPersona.profile?.signature && (
                  <p className="text-sm" style={{ color: t.settingsSubText }}>
                    {viewingPersona.profile.signature}
                  </p>
                )}
                {/* 简介 */}
                <div>
                  <div className="text-xs font-medium mb-1.5" style={{ color: t.settingsSubText }}>简介</div>
                  <div className="text-sm leading-relaxed" style={{ color: t.settingsText }}>{viewingPersona.description}</div>
                </div>
                {/* 标签 */}
                {viewingPersona.profile?.tags && viewingPersona.profile.tags.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {viewingPersona.profile.tags.map(tag => (
                      <span
                        key={tag}
                        className="text-xs px-3 py-1.5 rounded-full"
                        style={{
                          background: `${viewingPersona.color}25`,
                          color: t.settingsText,
                          border: `1px solid ${viewingPersona.color}55`,
                        }}
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
                {/* 操作按钮 */}
                <div className="flex gap-3 pt-2">
                  <button
                    className="flex-1 py-2.5 rounded-xl text-sm font-medium transition-opacity hover:opacity-80"
                    style={{ background: t.settingsInputBg, color: t.settingsText, border: `1px solid ${t.settingsInputBorder}` }}
                    onClick={() => {
                      const vp = viewingPersona
                      const latest = conversations
                        .filter(c => vp.id === 'default' ? !c.personaId || c.personaId === 'default' : c.personaId === vp.id)
                        .sort((a, b) => b.updatedAt - a.updatedAt)[0]
                      if (latest) switchConversation(latest.id)
                      else newConversationForPersona(vp.id)
                    }}
                  >
                    发消息
                  </button>
                  <button
                    className="flex-1 py-2.5 rounded-xl text-sm font-medium transition-opacity hover:opacity-80"
                    style={{ background: t.saveButton, color: t.saveButtonText }}
                    onClick={() => newConversationForPersona(viewingPersona.id)}
                  >
                    新建对话
                  </button>
                </div>
              </div>
              {/* 动态卡片 */}
              <div
                className="rounded-2xl px-6 py-5 flex flex-col gap-4"
                style={{
                  background: t.settingsBg,
                  backdropFilter: 'blur(16px)',
                  border: `1px solid ${t.headerBorder}`,
                }}
              >
                <div className="text-xs font-medium" style={{ color: t.settingsSubText }}>动态</div>
                <div className="py-8 flex items-center justify-center">
                  <span className="text-sm" style={{ color: t.settingsSubText }}>暂无动态</span>
                </div>
              </div>
            </div>
          ) : (
            <>
              {/* 消息列表 */}
              <div className="flex-1 overflow-y-auto px-4 py-6 space-y-4">
                {messages.length === 0 && (
                  <div className="text-center mt-20 text-sm" style={{ color: t.emptyText }}>开始对话吧</div>
                )}
                {(() => { const lastAsstIdx = messages.map(m => m.role).lastIndexOf('assistant'); return messages.map((msg, i) => {
                  const isStreamingRow = loading && i === messages.length - 1 && msg.role === 'assistant'
                  const streamInfo = isStreamingRow ? classifyStreamContent(msg.content) : null
                  return (
                  <div
                    key={i}
                    className={`flex flex-col ${msg.role === 'user' ? 'items-end pr-4' : 'items-start pl-4'}`}
                  >
                    {animatedIds.has(i) && <style>{`.bubble-${i}{animation:bubbleIn 0.25s ease}`}</style>}
                    {msg.role === 'assistant' && (() => {
                      if (!thinkingEnabled) return null
                      if (streamInfo) {
                        if (streamInfo.phase === 'waiting') return null
                        if (streamInfo.phase === 'typing' && !streamInfo.thinkText) return null
                        return (
                          <details open={streamInfo.phase === 'thinking'} className="mb-1 max-w-[70%]" style={{ fontSize: '0.72rem' }}>
                            <summary style={{ cursor: 'pointer', color: t.settingsSubText, listStyle: 'none', display: 'flex', alignItems: 'center', gap: '4px', padding: '2px 6px', userSelect: 'none' }}>
                              <span style={{ fontSize: '0.65rem', opacity: 0.7 }}>💭</span>
                              <span style={{ opacity: 0.7 }}>心声</span>
                            </summary>
                            <div style={{ marginTop: '4px', padding: '8px 10px', borderRadius: '10px', background: t.settingsBg, border: `1px solid ${t.settingsInputBorder}`, color: t.settingsSubText, fontStyle: 'italic', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                              {streamInfo.thinkText}
                            </div>
                          </details>
                        )
                      }
                      const thinkContent = extractThinkContent(msg.content)
                      if (!thinkContent) return null
                      return (
                        <details className="mb-1 max-w-[70%]" style={{ fontSize: '0.72rem' }}>
                          <summary style={{ cursor: 'pointer', color: t.settingsSubText, listStyle: 'none', display: 'flex', alignItems: 'center', gap: '4px', padding: '2px 6px', userSelect: 'none' }}>
                            <span style={{ fontSize: '0.65rem', opacity: 0.7 }}>💭</span>
                            <span style={{ opacity: 0.7 }}>心声</span>
                          </summary>
                          <div style={{ marginTop: '4px', padding: '8px 10px', borderRadius: '10px', background: t.settingsBg, border: `1px solid ${t.settingsInputBorder}`, color: t.settingsSubText, fontStyle: 'italic', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                            {thinkContent}
                          </div>
                        </details>
                      )
                    })()}
                    {msg.role === 'user' ? (
                      <div
                        className={"chat-bubble max-w-[70%] rounded-2xl px-4 py-3 text-sm leading-relaxed" + (animatedIds.has(i) ? " bubble-animate" : "")}
                        style={{ background: t.userBubble, color: t.userText, border: `1px solid ${t.userBubbleBorder}`, backdropFilter: 'blur(8px)', boxShadow: msg.marked ? 'inset 0 0 0 999px rgba(139, 45, 45, 0.08)' : undefined, position: 'relative', overflow: 'hidden' }}
                      >
                        {msg.marked && (
                          <div style={{ position: 'absolute', right: '10px', bottom: '8px', fontSize: '28px', opacity: 0.2, pointerEvents: 'none', userSelect: 'none', transform: 'rotate(-15deg)', filter: 'grayscale(1) brightness(10)' }}>🫆</div>
                        )}
                        {msg.content}
                      </div>
                    ) : (() => {
                      let segments: string[]
                      if (streamInfo) {
                        if (!streamInfo.mainText) return null
                        const rawSegments = streamInfo.mainText.split(/\n\n+/).filter(s => s.trim()).filter(s => !/^[-—\s]+$/.test(s.trim()))
                        segments = rawSegments.length === 0 ? [streamInfo.mainText] : rawSegments
                      } else {
                        const cleanContent = stripThink(msg.content)
                        const rawSegments = cleanContent.split(/\n\n+/).filter(s => s.trim()).filter(s => !/^[-—\s]+$/.test(s.trim()))
                        segments = rawSegments.length === 0 ? [''] : rawSegments
                      }
return (
                        <>
                          {segments.map((seg, si) => {
                            const strippedSeg = seg.replace(/\[sticker:[^\]]+\]/g, '').trim()
                            const isOnlySticker = !strippedSeg && /\[sticker:[^\]]+\]/.test(seg)
                            return (
                            <div
                              key={si}
                              className={"chat-bubble max-w-[70%] rounded-2xl px-4 py-3 text-sm leading-relaxed" + (animatedIds.has(i) ? " bubble-animate" : "") + (si < segments.length - 1 ? " mb-1" : "")}
                              style={{ background: isOnlySticker ? 'transparent' : t.assistantBubble, color: t.assistantText, border: isOnlySticker ? 'none' : `1px solid ${t.assistantBubbleBorder}`, backdropFilter: isOnlySticker ? 'none' : 'blur(10px)', boxShadow: [(msg.marked && !isOnlySticker) ? 'inset 0 0 0 999px rgba(139, 45, 45, 0.08)' : null, intimateMode ? 'inset 0 0 0 999px rgba(255, 200, 150, 0.06)' : null].filter(Boolean).join(', ') || undefined, position: 'relative', overflow: 'hidden' }}
                            >
                              {msg.marked && !isOnlySticker && (
                                <div style={{ position: 'absolute', right: '10px', bottom: '8px', fontSize: '28px', opacity: 0.2, pointerEvents: 'none', userSelect: 'none', transform: 'rotate(-15deg)', filter: 'grayscale(1) brightness(10)' }}>🫆</div>
                              )}
                              {renderMessageContent(seg, currentConversation?.personaId ?? 'default').map((part, pi) =>
                                typeof part === 'string' ? (
                                  <ReactMarkdown
                                    key={pi}
                                    components={{
                                      p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
                                      code: ({ children, className }) => {
                                        const isBlock = className?.includes('language-')
                                        const language = className?.replace('language-', '') ?? 'text'
                                        if (isBlock) {
                                          const { Prism: SyntaxHighlighter } = require('react-syntax-highlighter')
                                          const { oneDark } = require('react-syntax-highlighter/dist/cjs/styles/prism')
                                          return (
                                            <SyntaxHighlighter
                                              language={language}
                                              style={oneDark}
                                              customStyle={{ borderRadius: '8px', fontSize: '12px', margin: '8px 0', background: t.codeBg }}
                                            >
                                              {String(children).replace(/\n$/, '')}
                                            </SyntaxHighlighter>
                                          )
                                        }
                                        return (
                                          <code className="rounded px-1 py-0.5 text-xs" style={{ background: t.codeBg, color: t.codeText }}>{children}</code>
                                        )
                                      },
                                      ul: ({ children }) => <ul className="list-disc pl-4 mb-2 space-y-1">{children}</ul>,
                                      ol: ({ children }) => <ol className="list-decimal pl-4 mb-2 space-y-1">{children}</ol>,
                                      li: ({ children }) => <li>{children}</li>,
                                      strong: ({ children }) => <strong className="font-semibold" style={{ color: t.strongText }}>{children}</strong>,
                                      h1: ({ children }) => <h1 className="text-base font-semibold mb-2" style={{ color: t.strongText }}>{children}</h1>,
                                      h2: ({ children }) => <h2 className="text-sm font-semibold mb-2" style={{ color: t.strongText }}>{children}</h2>,
                                      h3: ({ children }) => <h3 className="text-sm font-semibold mb-1" style={{ color: t.strongText }}>{children}</h3>,
                                    }}
                                  >
                                    {part}
                                  </ReactMarkdown>
                                ) : (
                                  <div key={pi} style={{ display: 'inline-block', margin: '4px 0', padding: '6px', borderRadius: '12px', background: 'rgba(255,255,255,0.55)', backdropFilter: 'blur(4px)', overflow: 'hidden', position: 'relative' }}>
                                    <img src={part.url} alt={part.name} title={part.name} style={{ display: 'block', height: '100px', objectFit: 'contain' }} />
                                    {msg.marked && (
                                      <div style={{ position: 'absolute', right: '4px', bottom: '4px', fontSize: '34px', opacity: 0.2, pointerEvents: 'none', userSelect: 'none', transform: 'rotate(-15deg)', filter: 'grayscale(1) brightness(10)' }}>🫆</div>
                                    )}
                                  </div>
                                )
                              )}
                            </div>
                            )
                          })}
                        </>
                      )
                    })()}
                    {msg.timestamp && (
                      <div className="flex items-center gap-1" style={{ marginTop: '2px' }}>
                        <span style={{ fontSize: '0.62rem', color: t.timestampText, paddingLeft: '4px', paddingRight: '4px' }}>
                          {new Date(msg.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                        {msg.role === 'assistant' && (
                          <>
                            <button
                              onClick={() => playTTS(i, stripThink(msg.content).replace(/\[sticker:[^\]]+\]/g, ''))}
                              className="transition-opacity hover:opacity-100"
                              style={{ fontSize: '0.72rem', color: t.timestampText, opacity: 0.55, lineHeight: 1, padding: '0 2px', background: 'none', border: 'none', cursor: 'pointer' }}
                            >
                              {playingMsgIdx === i ? '⏸' : '🔊'}
                            </button>
                            {i === lastAsstIdx && (
                              <button
                                onClick={regenerate}
                                className="transition-opacity hover:opacity-100"
                                style={{ fontSize: '0.72rem', color: t.timestampText, opacity: 0.55, lineHeight: 1, padding: '0 2px', background: 'none', border: 'none', cursor: 'pointer' }}
                              >
                                🔄
                              </button>
                            )}
                          </>
                        )}
                        {msg.role === 'user' && (
                          <button
                            onClick={() => editMessage(i)}
                            className="transition-opacity hover:opacity-100"
                            style={{ fontSize: '0.72rem', color: t.timestampText, opacity: 0.55, lineHeight: 1, padding: '0 2px', background: 'none', border: 'none', cursor: 'pointer' }}
                          >
                            ✏️
                          </button>
                        )}
                        <button
                          onClick={() => toggleMark(i)}
                          className="transition-opacity hover:opacity-100"
                          style={{ fontSize: '0.72rem', color: msg.marked ? '#8b2d2d' : t.timestampText, opacity: msg.marked ? 0.9 : 0.35, lineHeight: 1, padding: '0 2px', background: 'none', border: 'none', cursor: 'pointer' }}
                        >
                          {msg.marked ? '♥' : '♡'}
                        </button>
                      </div>
                    )}
                  </div>
                  )
                })})()}
                {loading && (() => {
                  const lastMsg = messages[messages.length - 1]
                  const phase = lastMsg?.role === 'assistant' ? classifyStreamContent(lastMsg.content).phase : 'waiting'
                  const text = phase === 'typing' ? 'TA正在输入…' : 'TA正在思考…'
                  return (
                    <div className="flex justify-start pl-4">
                      <div key={text} className="status-fade-in" style={{ color: t.timestampText, fontSize: '0.8rem' }}>{text}</div>
                    </div>
                  )
                })()}
                <div ref={bottomRef} />
              </div>
              {/* 输入框 */}
              <div className="chat-input-area px-4 pb-6 shrink-0 sticky bottom-0">
                <div
                  className="flex items-end gap-2 rounded-2xl px-4 py-3"
                  style={{
                    background: t.inputBg,
                    backdropFilter: 'blur(12px)',
                    border: `1px solid ${t.inputBorder}`,
                    boxShadow: t.inputShadow,
                  }}
                >
                  <textarea
                    ref={inputRef}
                    className="flex-1 bg-transparent resize-none outline-none text-sm"
                    style={{ color: t.inputText, maxHeight: '160px', overflowY: 'auto', fontSize: '16px' }}
                    placeholder={`给 ${currentConversation?.personaId && currentConversation.personaId !== 'default' ? (getPersonaById(currentConversation.personaId)?.name ?? 'Claude') : 'Claude'} 发送消息`}
                    rows={1}
                    value={input}
                    onChange={e => {
                      setInput(e.target.value)
                      e.target.style.height = 'auto'
                      e.target.style.height = `${e.target.scrollHeight}px`
                    }}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault()
                        sendMessage()
                      }
                    }}
                  />
                  <button
                    onClick={() => sendMessage()}
                    disabled={loading || !input.trim()}
                    className="transition-opacity disabled:opacity-30 flex items-center justify-center rounded-full w-8 h-8"
                    style={{ backgroundColor: input.trim() && !loading ? t.sendButton : 'transparent', border: `2px solid ${t.sendButton}`, opacity: loading || !input.trim() ? 0.3 : 1 }}
                  >
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M7 11.5V2.5M7 2.5L3 6.5M7 2.5L11 6.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </button>
                </div>
                <p className="input-hint text-center text-xs mt-2" style={{ color: t.footerText }}>按 Enter 发送，Shift+Enter 换行</p>
              </div>
            </>
          )}
        </div>
      </div>

      {/* API 设置弹窗 */}
      {showApiSettings && (() => {
        const tempLabel = apiDraft.temperature <= 0.5 ? '保守' : apiDraft.temperature <= 1.5 ? '平衡' : '创新'
        const draftNameExists = apiConfigs.some(c => c.name === apiDraft.name)

        const saveConfig = () => {
          if (!apiDraft.name.trim()) return
          const next = draftNameExists
            ? apiConfigs.map(c => c.name === apiDraft.name ? { ...apiDraft } : c)
            : [...apiConfigs, { ...apiDraft }]
          setApiConfigs(next)
          localStorage.setItem(API_CONFIGS_KEY, JSON.stringify(next))
        }

        const applyConfig = (name: string) => {
          setActiveConfigName(name)
          localStorage.setItem(ACTIVE_CONFIG_KEY, name)
        }

        const deleteConfig = (name: string) => {
          const next = apiConfigs.filter(c => c.name !== name)
          setApiConfigs(next)
          localStorage.setItem(API_CONFIGS_KEY, JSON.stringify(next))
          if (activeConfigName === name) {
            setActiveConfigName(null)
            localStorage.removeItem(ACTIVE_CONFIG_KEY)
          }
        }

        const testConnection = async () => {
          setApiTestStatus('testing')
          setApiTestMsg('')
          try {
            const cfg = apiDraft
            const res = await fetch('/api/chat', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                messages: [{ role: 'user', content: 'hi' }],
                systemPrompt: '',
                devMode: false,
                apiConfig: {
                  baseUrl: cfg.baseUrl, apiKey: cfg.apiKey, model: cfg.model,
                  llmEndpoint: cfg.llmEndpoint, temperature: cfg.temperature,
                },
              }),
            })
            if (res.ok) {
              const text = await streamToString(res)
              setApiTestStatus(text ? 'ok' : 'fail')
              setApiTestMsg(text ? '连接成功' : '响应为空')
            } else {
              const j = await res.json().catch(() => ({}))
              setApiTestStatus('fail')
              setApiTestMsg(j.error ?? `HTTP ${res.status}`)
            }
          } catch (e) { setApiTestStatus('fail'); setApiTestMsg(String(e)) }
        }

        const fetchModelList = async () => {
          setFetchingModels(true)
          try {
            const base = apiDraft.baseUrl.replace(/\/$/, '')
            const res = await fetch(`${base}${apiDraft.modelsEndpoint}`, {
              headers: { 'Authorization': `Bearer ${apiDraft.apiKey}` },
            })
            const json = await res.json()
            const list: string[] = (json.data ?? json.models ?? []).map((m: { id?: string; name?: string } | string) =>
              typeof m === 'string' ? m : (m.id ?? m.name ?? '')
            ).filter(Boolean)
            setModelList(list)
          } catch { setModelList([]) }
          setFetchingModels(false)
        }

        const inp = (label: string, field: keyof ApiConfig, opts?: { placeholder?: string; mono?: boolean; type?: string }) => (
          <div className="flex flex-col gap-1">
            <label className="text-xs" style={{ color: t.settingsSubText }}>{label}</label>
            <input
              type={opts?.type ?? 'text'}
              className={`w-full rounded-lg px-3 py-1.5 text-xs outline-none${opts?.mono ? ' font-mono' : ''}`}
              style={{ background: t.settingsInputBg, color: t.settingsText, border: `1px solid ${t.settingsInputBorder}` }}
              placeholder={opts?.placeholder ?? ''}
              value={apiDraft[field] as string}
              onChange={e => setApiDraft(p => ({ ...p, [field]: e.target.value }))}
            />
          </div>
        )

        return (
          <div className="fixed inset-0 flex items-center justify-center z-10" style={{ background: t.overlayBg, backdropFilter: 'blur(4px)' }}>
            <div className="rounded-2xl w-full mx-4 flex flex-col" style={{ background: t.settingsBg, backdropFilter: 'blur(16px)', maxWidth: '520px', maxHeight: '90vh' }}>
              {/* 标题 */}
              <div className="flex items-center justify-between px-5 pt-4 pb-3 shrink-0" style={{ borderBottom: `1px solid ${t.headerBorder}` }}>
                <h2 className="text-sm font-medium" style={{ color: t.settingsText }}>API 设置</h2>
                <div className="flex items-center gap-2">
                  {activeConfigName && (
                    <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: '#22c55e22', color: '#16a34a', border: '1px solid #22c55e55' }}>
                      已应用：{activeConfigName}
                    </span>
                  )}
                  <button onClick={() => setShowApiSettings(false)} className="text-xs transition-opacity hover:opacity-70" style={{ color: t.settingsSubText }}>✕</button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-4">
                {/* 已保存配置列表 */}
                {apiConfigs.length > 0 && (
                  <div>
                    <div className="text-xs font-medium mb-2" style={{ color: t.settingsSubText }}>已保存配置</div>
                    <div className="flex flex-col gap-1.5">
                      {apiConfigs.map(cfg => (
                        <div key={cfg.name} className="flex items-center gap-2 px-3 py-2 rounded-xl" style={{ background: t.settingsInputBg, border: `1px solid ${cfg.name === activeConfigName ? '#22c55e88' : t.settingsInputBorder}` }}>
                          <div className="flex-1 min-w-0">
                            <span className="text-xs font-medium" style={{ color: t.settingsText }}>{cfg.name}</span>
                            <span className="text-xs ml-2" style={{ color: t.settingsSubText }}>{cfg.model || '未设模型'} · {cfg.baseUrl.replace(/https?:\/\//, '').slice(0, 24)}</span>
                          </div>
                          <div className="flex gap-1.5 shrink-0">
                            <button onClick={() => applyConfig(cfg.name)} className="text-xs px-2 py-0.5 rounded-md transition-opacity hover:opacity-70" style={{ background: cfg.name === activeConfigName ? '#22c55e22' : t.settingsBg, color: cfg.name === activeConfigName ? '#16a34a' : t.settingsSubText, border: `1px solid ${cfg.name === activeConfigName ? '#22c55e55' : t.settingsInputBorder}` }}>
                              {cfg.name === activeConfigName ? '已应用' : '应用'}
                            </button>
                            <button onClick={() => setApiDraft({ ...cfg })} className="text-xs px-2 py-0.5 rounded-md transition-opacity hover:opacity-70" style={{ color: t.settingsSubText, border: `1px solid ${t.settingsInputBorder}` }}>编辑</button>
                            <button onClick={() => deleteConfig(cfg.name)} className="text-xs px-2 py-0.5 rounded-md transition-opacity hover:opacity-70" style={{ color: '#dc2626', border: '1px solid #dc262644' }}>删除</button>
                          </div>
                        </div>
                      ))}
                    </div>
                    <div style={{ borderTop: `1px solid ${t.settingsInputBorder}`, margin: '12px 0 0' }} />
                  </div>
                )}

                {/* 编辑器表单 */}
                <div className="flex flex-col gap-3">
                  <div className="text-xs font-medium" style={{ color: t.settingsSubText }}>
                    {draftNameExists ? `编辑配置：${apiDraft.name}` : '新建配置'}
                  </div>

                  {inp('配置名称', 'name', { placeholder: '如 my-openrouter' })}
                  {inp('API 地址 (Base URL)', 'baseUrl', { placeholder: 'https://openrouter.ai/api/v1' })}

                  {/* API Key 带显示/隐藏 */}
                  <div className="flex flex-col gap-1">
                    <label className="text-xs" style={{ color: t.settingsSubText }}>API Key</label>
                    <div className="flex gap-2">
                      <input
                        type={apiKeyVisible ? 'text' : 'password'}
                        className="flex-1 rounded-lg px-3 py-1.5 text-xs outline-none font-mono"
                        style={{ background: t.settingsInputBg, color: t.settingsText, border: `1px solid ${t.settingsInputBorder}` }}
                        placeholder="sk-..."
                        value={apiDraft.apiKey}
                        onChange={e => setApiDraft(p => ({ ...p, apiKey: e.target.value }))}
                      />
                      <button onClick={() => setApiKeyVisible(p => !p)} className="text-xs px-2.5 rounded-lg shrink-0 transition-opacity hover:opacity-70" style={{ background: t.settingsInputBg, color: t.settingsSubText, border: `1px solid ${t.settingsInputBorder}` }}>
                        {apiKeyVisible ? '隐藏' : '显示'}
                      </button>
                    </div>
                  </div>

                  {/* 模型 */}
                  <div className="flex flex-col gap-1">
                    <label className="text-xs" style={{ color: t.settingsSubText }}>模型</label>
                    <div className="flex gap-2">
                      <input
                        list="api-model-list"
                        className="flex-1 rounded-lg px-3 py-1.5 text-xs outline-none"
                        style={{ background: t.settingsInputBg, color: t.settingsText, border: `1px solid ${t.settingsInputBorder}` }}
                        placeholder="如 anthropic/claude-sonnet-4-6"
                        value={apiDraft.model}
                        onChange={e => setApiDraft(p => ({ ...p, model: e.target.value }))}
                      />
                      <datalist id="api-model-list">{modelList.map(m => <option key={m} value={m} />)}</datalist>
                      <button onClick={fetchModelList} disabled={fetchingModels || !apiDraft.baseUrl || !apiDraft.apiKey} className="text-xs px-2.5 rounded-lg shrink-0 transition-opacity disabled:opacity-40 hover:opacity-70" style={{ background: t.settingsInputBg, color: t.settingsSubText, border: `1px solid ${t.settingsInputBorder}` }}>
                        {fetchingModels ? '…' : '拉取列表'}
                      </button>
                    </div>
                  </div>

                  {/* 端点 */}
                  <div className="grid grid-cols-2 gap-2">
                    {inp('LLM 端点', 'llmEndpoint', { placeholder: '/chat/completions' })}
                    {inp('模型列表端点', 'modelsEndpoint', { placeholder: '/models' })}
                  </div>

                  {/* 温度滑块 */}
                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between">
                      <label className="text-xs" style={{ color: t.settingsSubText }}>温度</label>
                      <span className="text-xs" style={{ color: t.settingsText }}>{apiDraft.temperature.toFixed(2)} <span style={{ color: t.settingsSubText }}>({tempLabel})</span></span>
                    </div>
                    <input
                      type="range" min="0" max="2" step="0.01"
                      value={apiDraft.temperature}
                      onChange={e => setApiDraft(p => ({ ...p, temperature: parseFloat(e.target.value) }))}
                      className="w-full"
                    />
                    <div className="flex justify-between text-xs" style={{ color: t.settingsSubText }}>
                      <span>0 保守</span><span>1 平衡</span><span>2 创新</span>
                    </div>
                  </div>

                  {/* 测试结果 */}
                  {apiTestStatus !== 'idle' && (
                    <div className="text-xs px-3 py-2 rounded-lg" style={{
                      background: apiTestStatus === 'ok' ? '#22c55e22' : apiTestStatus === 'fail' ? '#ef444422' : t.settingsInputBg,
                      color: apiTestStatus === 'ok' ? '#16a34a' : apiTestStatus === 'fail' ? '#dc2626' : t.settingsSubText,
                      border: `1px solid ${apiTestStatus === 'ok' ? '#22c55e55' : apiTestStatus === 'fail' ? '#ef444455' : t.settingsInputBorder}`,
                    }}>
                      {apiTestStatus === 'testing' ? '测试中…' : apiTestMsg}
                    </div>
                  )}
                </div>
              </div>

              {/* 底栏 */}
              <div className="flex items-center justify-between px-5 py-3 shrink-0" style={{ borderTop: `1px solid ${t.headerBorder}` }}>
                <button
                  onClick={testConnection}
                  disabled={apiTestStatus === 'testing' || !apiDraft.baseUrl || !apiDraft.apiKey}
                  className="text-xs rounded-lg px-3 py-2 transition-opacity disabled:opacity-40 hover:opacity-70"
                  style={{ background: t.settingsInputBg, color: t.settingsText, border: `1px solid ${t.settingsInputBorder}` }}
                >
                  测试连接
                </button>
                <div className="flex gap-2">
                  <button onClick={() => { setApiDraft({ ...DEFAULT_API_DRAFT }); setApiTestStatus('idle'); setModelList([]) }} className="text-xs rounded-lg px-3 py-2 transition-opacity hover:opacity-70" style={{ color: t.settingsSubText }}>
                    新建
                  </button>
                  <button
                    onClick={saveConfig}
                    disabled={!apiDraft.name.trim() || !apiDraft.baseUrl || !apiDraft.apiKey}
                    className="text-xs rounded-lg px-4 py-2 transition-opacity disabled:opacity-40"
                    style={{ background: t.saveButton, color: t.saveButtonText }}
                  >
                    {draftNameExists ? '保存修改' : '保存新配置'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )
      })()}

      {editingPersona && (
        <PersonaSettings
          key={editingPersona.id}
          persona={editingPersona}
          allPersonas={allPersonas}
          isNew={editingIsNew}
          theme={t}
          onSave={handlePersonaSave}
          onClose={() => setEditingPersona(null)}
          onSwitch={(id) => {
            if (id === '__new__') {
              setEditingPersona({ id: `custom-${Date.now()}`, name: '', color: '#9a9a9a', description: '', system_prompt: '' })
              setEditingIsNew(true)
            } else {
              const p = allPersonas.find(pp => pp.id === id)
              if (p) {
                setEditingPersona({ ...p, system_prompt: getEffectiveSystemPrompt(id) })
                setEditingIsNew(false)
              }
            }
          }}
        />
      )}

      {/* 开发者密码弹窗 */}
      {showDevPasswordDialog && (
        <div className="fixed inset-0 flex items-center justify-center z-30" style={{ background: t.overlayBg, backdropFilter: 'blur(4px)' }}>
          <div
            className="rounded-2xl p-6 w-72"
            style={{ background: t.settingsBg, backdropFilter: 'blur(16px)', border: `1px solid ${t.headerBorder}`, boxShadow: t.inputShadow }}
          >
            <p className="text-sm font-medium mb-4" style={{ color: t.settingsText }}>
              {devPasswordMode === 'verify' ? '请输入开发者密码' : '设置新密码'}
            </p>
            <input
              type="password"
              className="w-full text-sm px-3 py-2 rounded-lg outline-none"
              style={{ background: t.settingsInputBg, color: t.settingsText, border: `1px solid ${t.settingsInputBorder}` }}
              value={devPasswordInput}
              onChange={e => { setDevPasswordInput(e.target.value); setDevPasswordError('') }}
              placeholder={devPasswordMode === 'verify' ? '输入密码' : '输入新密码（4位）'}
              maxLength={4}
              onKeyDown={e => { if (e.key === 'Enter') handleDevPasswordConfirm() }}
              autoFocus
            />
            {devPasswordError && (
              <p className="text-xs mt-2" style={{ color: '#e55' }}>{devPasswordError}</p>
            )}
            <div className="flex gap-2 mt-4">
              <button
                onClick={() => { setShowDevPasswordDialog(false); setDevPasswordInput(''); setDevPasswordError('') }}
                className="flex-1 py-2 text-xs rounded-lg transition-opacity hover:opacity-70"
                style={{ background: t.settingsInputBg, color: t.settingsSubText, border: `1px solid ${t.settingsInputBorder}` }}
              >取消</button>
              <button
                onClick={handleDevPasswordConfirm}
                className="flex-1 py-2 text-xs rounded-lg font-medium transition-opacity hover:opacity-70"
                style={{ background: t.saveButton, color: t.saveButtonText }}
              >确认</button>
            </div>
          </div>
        </div>
      )}

      {/* 预览弹窗 */}
      {showPreview && (
        <div className="fixed inset-0 flex items-center justify-center z-20" style={{ background: t.overlayBg, backdropFilter: 'blur(4px)' }}>
          <div
            className="rounded-2xl w-full mx-4 flex flex-col"
            style={{ background: t.settingsBg, backdropFilter: 'blur(16px)', maxWidth: '600px', maxHeight: '75vh' }}
          >
            <div className="flex items-center justify-between px-6 pt-5 pb-4 shrink-0" style={{ borderBottom: `1px solid ${t.headerBorder}` }}>
              <h2 className="text-sm font-medium" style={{ color: t.settingsText }}>System Prompt 预览</h2>
              <button onClick={() => setShowPreview(false)} className="text-sm transition-opacity hover:opacity-60" style={{ color: t.settingsSubText }}>✕</button>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-4">
              <pre className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: t.settingsText, fontFamily: 'inherit' }}>
                {systemPromptDraft || '（空）'}
              </pre>
            </div>
            <div className="px-6 py-4 flex justify-end shrink-0" style={{ borderTop: `1px solid ${t.headerBorder}` }}>
              <button onClick={() => setShowPreview(false)} className="text-xs rounded-lg px-4 py-2" style={{ background: t.saveButton, color: t.saveButtonText }}>关闭</button>
            </div>
          </div>
        </div>
      )}

      {/* 删除对话确认弹窗 */}
      {pendingDeleteId && (
        <div className="fixed inset-0 flex items-center justify-center z-30" style={{ background: t.overlayBg, backdropFilter: 'blur(4px)' }}>
          <div
            className="rounded-2xl p-6 w-80"
            style={{ background: t.settingsBg, backdropFilter: 'blur(16px)', border: `1px solid ${t.headerBorder}`, boxShadow: t.inputShadow }}
          >
            <p className="text-sm font-medium mb-2" style={{ color: t.settingsText }}>删除这段对话</p>
            <p className="text-xs mb-4" style={{ color: t.settingsSubText }}>可以只删除对话本身，也可以连同这段对话自动生成的记忆一起删除。</p>
            <div className="space-y-2">
              <button
                onClick={() => { deleteConversation(pendingDeleteId); setPendingDeleteId(null) }}
                className="w-full py-2 text-xs rounded-lg transition-opacity hover:opacity-70"
                style={{ background: t.settingsInputBg, color: t.settingsText, border: `1px solid ${t.settingsInputBorder}` }}
              >仅删除对话</button>
              <div>
                <button
                  onClick={async () => {
                    await fetch('/api/persona-memory/delete-by-conversation', {
                      method: 'DELETE',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ conversationId: pendingDeleteId }),
                    }).catch(() => {})
                    deleteConversation(pendingDeleteId)
                    setPendingDeleteId(null)
                  }}
                  className="w-full py-2 text-xs rounded-lg font-medium transition-opacity hover:opacity-70"
                  style={{ background: '#8b2d2d', color: '#fff' }}
                >同时删除相关记忆</button>
                <p className="text-xs mt-1" style={{ color: t.settingsSubText }}>仅能清除本次对话中自动生成的记忆，不影响导入或迁移的历史记忆</p>
              </div>
              <button
                onClick={() => setPendingDeleteId(null)}
                className="w-full py-2 text-xs rounded-lg transition-opacity hover:opacity-70"
                style={{ color: t.settingsSubText }}
              >取消</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

