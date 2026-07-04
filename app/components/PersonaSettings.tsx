'use client'
import { useState } from 'react'
import { type Persona } from '../personas'

type Tab = 'basic' | 'prompt' | 'voice' | 'memory'

interface Props {
  persona: Persona
  allPersonas: Persona[]
  isNew: boolean
  theme: Record<string, string>
  onSave: (p: Persona) => void
  onClose: () => void
}

const VOICE_OPTIONS = [
  { id: 'male-qn-qingse', label: '清涩少年' },
  { id: 'Chinese (Mandarin)_Gentleman', label: '温文绅士' },
  { id: 'Chinese (Mandarin)_Stubborn_Friend', label: '损友' },
  { id: 'female-shaonv', label: '少女' },
  { id: 'female-yujie', label: '御姐' },
  { id: 'male-qn-jingying', label: '精英青年' },
]

const AMBIENT_OPTIONS: { id: string | null; label: string }[] = [
  { id: null, label: '无' },
  { id: 'rain', label: '雨' },
  { id: 'forest', label: '林' },
  { id: 'water', label: '水' },
]

export default function PersonaSettings({ persona, isNew, theme: t, onSave, onClose }: Props) {
  const [tab, setTab] = useState<Tab>('basic')
  const [name, setName] = useState(persona.name ?? '')
  const [color, setColor] = useState(persona.color ?? '#8B9BBA')
  const [description, setDescription] = useState(persona.description ?? '')
  const [signature, setSignature] = useState(persona.signature ?? persona.profile?.signature ?? '')
  const [age, setAge] = useState<string>(persona.age?.toString() ?? persona.profile?.age?.toString() ?? '')
  const [gender, setGender] = useState(persona.gender ?? persona.profile?.gender ?? '')
  const [constellation, setConstellation] = useState(persona.constellation ?? persona.profile?.constellation ?? '')
  const [note, setNote] = useState(persona.note ?? persona.profile?.note ?? '')
  const [tags, setTags] = useState(persona.tags?.join(', ') ?? persona.profile?.tags?.join(', ') ?? '')
  const [systemPrompt, setSystemPrompt] = useState(persona.system_prompt ?? persona.systemPrompt ?? '')
  const [voiceId, setVoiceId] = useState(persona.voice_id ?? 'male-qn-qingse')
  const [defaultAmbient, setDefaultAmbient] = useState<string | null>(persona.default_ambient ?? null)
  const [defaultIntimate, setDefaultIntimate] = useState(persona.default_intimate ?? false)

  const tabs: { key: Tab; label: string }[] = [
    { key: 'basic', label: '基础' },
    { key: 'prompt', label: '人设' },
    { key: 'voice', label: '语音' },
    { key: 'memory', label: '记忆' },
  ]

  const handleSave = () => {
    if (!name.trim()) return
    const updated: Persona = {
      ...persona,
      id: persona.id,
      name: name.trim(),
      color,
      description: description.trim(),
      system_prompt: systemPrompt,
      age: age ? parseInt(age) : null,
      gender: gender || null,
      constellation: constellation || null,
      signature: signature || null,
      note: note || null,
      tags: tags ? tags.split(',').map(s => s.trim()).filter(Boolean) : [],
      voice_id: voiceId,
      default_ambient: defaultAmbient,
      default_intimate: defaultIntimate,
      is_custom: persona.is_custom ?? !persona.is_builtin,
    }
    onSave(updated)
  }

  const playPreview = async () => {
    try {
      const res = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: '今天天气真不错，适合出门走走。', voice: voiceId, speed: 1.0 }),
      })
      if (!res.ok) return
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const audio = new Audio(url)
      audio.onended = () => URL.revokeObjectURL(url)
      audio.play()
    } catch {}
  }

  const inputStyle = { background: t.settingsInputBg, color: t.settingsText, border: `1px solid ${t.settingsInputBorder}` }

  return (
    <div className="fixed inset-0 flex items-center justify-center z-50" style={{ background: t.overlayBg, backdropFilter: 'blur(4px)' }}>
      <div className="rounded-2xl w-full mx-4 flex flex-col" style={{ background: t.settingsBg, backdropFilter: 'blur(16px)', maxWidth: '680px', maxHeight: '85vh' }}>
        {/* 标题栏 */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4 shrink-0" style={{ borderBottom: `1px solid ${t.headerBorder}` }}>
          <div className="flex items-center gap-3">
            <div className="w-3 h-3 rounded-full" style={{ background: color }} />
            <h2 className="text-sm font-medium" style={{ color: t.settingsText }}>{isNew ? '创建新角色' : name || '编辑角色'}</h2>
          </div>
          <button onClick={onClose} className="text-sm transition-opacity hover:opacity-60" style={{ color: t.settingsSubText }}>✕</button>
        </div>

        {/* Tab 栏 */}
        <div className="flex px-6 pt-3 gap-1 shrink-0" style={{ borderBottom: `1px solid ${t.headerBorder}` }}>
          {tabs.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className="px-4 py-2 text-xs font-medium transition-all rounded-t-lg"
              style={{
                color: tab === key ? t.settingsText : t.settingsSubText,
                background: tab === key ? t.settingsInputBg : 'transparent',
                borderBottom: tab === key ? `2px solid ${t.sendButton}` : '2px solid transparent',
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {/* 内容区 */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {tab === 'basic' && (
            <div className="space-y-4">
              <div>
                <label className="text-xs mb-1 block" style={{ color: t.settingsSubText }}>名字</label>
                <input className="w-full rounded-xl px-3 py-2 text-sm outline-none" style={inputStyle} value={name} onChange={e => setName(e.target.value)} placeholder="角色名称" />
              </div>
              <div className="flex gap-4">
                <div className="flex-1">
                  <label className="text-xs mb-1 block" style={{ color: t.settingsSubText }}>颜色</label>
                  <div className="flex items-center gap-2">
                    <input type="color" value={color} onChange={e => setColor(e.target.value)} className="w-8 h-8 rounded cursor-pointer" style={{ border: 'none' }} />
                    <input className="flex-1 rounded-xl px-3 py-2 text-sm outline-none" style={inputStyle} value={color} onChange={e => setColor(e.target.value)} />
                  </div>
                </div>
                <div className="flex-1">
                  <label className="text-xs mb-1 block" style={{ color: t.settingsSubText }}>年龄</label>
                  <input className="w-full rounded-xl px-3 py-2 text-sm outline-none" style={inputStyle} value={age} onChange={e => setAge(e.target.value)} placeholder="可选" />
                </div>
              </div>
              <div className="flex gap-4">
                <div className="flex-1">
                  <label className="text-xs mb-1 block" style={{ color: t.settingsSubText }}>性别</label>
                  <input className="w-full rounded-xl px-3 py-2 text-sm outline-none" style={inputStyle} value={gender} onChange={e => setGender(e.target.value)} placeholder="可选" />
                </div>
                <div className="flex-1">
                  <label className="text-xs mb-1 block" style={{ color: t.settingsSubText }}>星座</label>
                  <input className="w-full rounded-xl px-3 py-2 text-sm outline-none" style={inputStyle} value={constellation} onChange={e => setConstellation(e.target.value)} placeholder="可选" />
                </div>
              </div>
              <div>
                <label className="text-xs mb-1 block" style={{ color: t.settingsSubText }}>简介</label>
                <input className="w-full rounded-xl px-3 py-2 text-sm outline-none" style={inputStyle} value={description} onChange={e => setDescription(e.target.value)} placeholder="一句话描述这个角色" />
              </div>
              <div>
                <label className="text-xs mb-1 block" style={{ color: t.settingsSubText }}>签名</label>
                <input className="w-full rounded-xl px-3 py-2 text-sm outline-none" style={inputStyle} value={signature} onChange={e => setSignature(e.target.value)} placeholder="角色签名" />
              </div>
              <div>
                <label className="text-xs mb-1 block" style={{ color: t.settingsSubText }}>称呼</label>
                <input className="w-full rounded-xl px-3 py-2 text-sm outline-none" style={inputStyle} value={note} onChange={e => setNote(e.target.value)} placeholder="怎么称呼用户" />
              </div>
              <div>
                <label className="text-xs mb-1 block" style={{ color: t.settingsSubText }}>标签</label>
                <input className="w-full rounded-xl px-3 py-2 text-sm outline-none" style={inputStyle} value={tags} onChange={e => setTags(e.target.value)} placeholder="用逗号分隔，如：温柔, 克制, 留白" />
              </div>
            </div>
          )}

          {tab === 'prompt' && (
            <div className="space-y-3">
              <p className="text-xs" style={{ color: t.settingsSubText }}>定义角色的性格、说话方式、行为规则。这段文字会作为 system prompt 发送给模型。</p>
              <textarea
                className="w-full rounded-xl px-4 py-3 text-sm outline-none resize-none leading-relaxed"
                style={{ ...inputStyle, minHeight: '360px' }}
                value={systemPrompt}
                onChange={e => setSystemPrompt(e.target.value)}
                placeholder="描述这个角色是谁，怎么说话，什么性格……"
              />
              <p className="text-xs text-right" style={{ color: t.settingsSubText }}>{systemPrompt.length} 字符</p>
            </div>
          )}

          {tab === 'voice' && (
            <div className="space-y-4">
              <div>
                <label className="text-xs mb-2 block" style={{ color: t.settingsSubText }}>TTS 声音</label>
                <div className="space-y-1">
                  {VOICE_OPTIONS.map(v => (
                    <button
                      key={v.id}
                      onClick={() => setVoiceId(v.id)}
                      className="w-full text-left px-4 py-2.5 rounded-xl text-sm transition-all"
                      style={{
                        background: voiceId === v.id ? t.userBubble : 'transparent',
                        color: voiceId === v.id ? t.headerText : t.settingsText,
                        border: `1px solid ${voiceId === v.id ? t.sendButton : t.settingsInputBorder}`,
                      }}
                    >
                      {v.label}
                    </button>
                  ))}
                </div>
                <button
                  onClick={playPreview}
                  className="mt-3 text-xs px-4 py-2 rounded-xl transition-opacity hover:opacity-70"
                  style={{ color: t.settingsSubText, border: `1px solid ${t.headerBorder}` }}
                >
                  试听当前声音
                </button>
              </div>
              <div style={{ borderTop: `1px solid ${t.headerBorder}`, paddingTop: '16px' }}>
                <label className="text-xs mb-2 block" style={{ color: t.settingsSubText }}>默认环境音</label>
                <div className="flex gap-2">
                  {AMBIENT_OPTIONS.map(a => (
                    <button
                      key={a.id ?? 'none'}
                      onClick={() => setDefaultAmbient(a.id)}
                      className="px-4 py-2 rounded-xl text-xs transition-all"
                      style={{
                        background: defaultAmbient === a.id ? t.userBubble : 'transparent',
                        color: defaultAmbient === a.id ? t.headerText : t.settingsSubText,
                        border: `1px solid ${defaultAmbient === a.id ? t.sendButton : t.settingsInputBorder}`,
                      }}
                    >
                      {a.label}
                    </button>
                  ))}
                </div>
              </div>
              <div style={{ borderTop: `1px solid ${t.headerBorder}`, paddingTop: '16px' }}>
                <button
                  onClick={() => setDefaultIntimate(p => !p)}
                  className="flex items-center gap-2 text-xs transition-opacity hover:opacity-70"
                  style={{ color: t.settingsText }}
                >
                  <span style={{ color: defaultIntimate ? '#e8a87c' : t.settingsSubText }}>{defaultIntimate ? '🌙' : '☽'}</span>
                  <span>默认开启缠绵模式：{defaultIntimate ? '是' : '否'}</span>
                </button>
              </div>
            </div>
          )}

          {tab === 'memory' && (
            <div className="space-y-3">
              <p className="text-xs" style={{ color: t.settingsSubText }}>角色的记忆池。支持从对话中自动提取、手动添加、或导入外部文件。</p>
              <div className="flex items-center justify-center py-12">
                <p className="text-xs" style={{ color: t.settingsSubText }}>记忆系统开发中……</p>
              </div>
            </div>
          )}
        </div>

        {/* 底部按钮 */}
        <div className="flex justify-between items-center px-6 py-4 shrink-0" style={{ borderTop: `1px solid ${t.headerBorder}` }}>
          <button onClick={onClose} className="text-xs px-4 py-2 transition-opacity hover:opacity-70" style={{ color: t.settingsSubText }}>取消</button>
          <button onClick={handleSave} className="text-xs px-6 py-2 rounded-xl transition-opacity hover:opacity-70" style={{ background: t.saveButton, color: t.saveButtonText }}>保存</button>
        </div>
      </div>
    </div>
  )
}
