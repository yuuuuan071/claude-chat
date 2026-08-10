'use client'
import { useEffect, useState } from 'react'
import { type Theme } from '../themes'
import { type Persona, FALLBACK_PERSONAS, adaptPersona } from '../personas'

type DiaryEntry = {
  id: string
  diary_date: string
  content: string
  memory_count: number | null
}

export default function DiaryView({ theme: t }: { theme: Theme }) {
  const [personas, setPersonas] = useState<Persona[]>([])
  const [personaId, setPersonaId] = useState<string | null>(null)
  const [entries, setEntries] = useState<DiaryEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    const loadPersonas = async () => {
      try {
        const res = await fetch('/api/personas')
        const merged = new Map<string, Persona>()
        FALLBACK_PERSONAS.forEach(p => merged.set(p.id, adaptPersona(p)))
        if (res.ok) {
          const dbPersonas: Persona[] = await res.json()
          dbPersonas.forEach(p => merged.set(p.id, adaptPersona(p)))
        }
        const list = Array.from(merged.values())
        setPersonas(list)
        setPersonaId(prev => prev ?? list[0]?.id ?? 'default')
      } catch {
        const list = FALLBACK_PERSONAS.map(adaptPersona)
        setPersonas(list)
        setPersonaId(prev => prev ?? list[0]?.id ?? 'default')
      }
    }
    loadPersonas()
  }, [])

  useEffect(() => {
    if (!personaId) return
    setLoading(true)
    setMessage(null)
    fetch(`/api/persona-diary/list?personaId=${encodeURIComponent(personaId)}`)
      .then(r => r.ok ? r.json() : { diaries: [] })
      .then(data => setEntries(data.diaries ?? []))
      .catch(() => setEntries([]))
      .finally(() => setLoading(false))
  }, [personaId])

  const generateToday = async () => {
    if (!personaId) return
    setGenerating(true)
    setMessage(null)
    try {
      const today = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10)
      const res = await fetch('/api/persona-diary/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ personaId, date: today }),
      })
      const data = await res.json()
      if (data.skipped) {
        setMessage('今天还没有值得记的事')
      } else if (data.content) {
        const listRes = await fetch(`/api/persona-diary/list?personaId=${encodeURIComponent(personaId)}`)
        const listData = await listRes.json()
        setEntries(listData.diaries ?? [])
      } else {
        setMessage('生成失败，请稍后再试')
      }
    } catch {
      setMessage('生成失败，请稍后再试')
    }
    setGenerating(false)
  }

  const inputStyle = { background: t.settingsInputBg, color: t.settingsText, border: `1px solid ${t.settingsInputBorder}` }

  return (
    <div className="flex-1 overflow-y-auto px-4 py-6">
      <div className="max-w-2xl w-full mx-auto space-y-3">
        <div className="flex items-center gap-2">
          <select
            value={personaId ?? ''}
            onChange={e => setPersonaId(e.target.value)}
            className="rounded-xl px-3 py-2 text-xs outline-none cursor-pointer"
            style={inputStyle}
          >
            {personas.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <button
            onClick={generateToday}
            disabled={generating || !personaId}
            className="text-xs px-3 py-2 rounded-xl transition-opacity hover:opacity-70 disabled:opacity-40"
            style={{ background: t.userBubble, color: t.headerText, border: `1px solid ${t.sendButton}` }}
          >
            {generating ? '生成中…' : '生成今天'}
          </button>
        </div>

        {message && (
          <div
            className="rounded-xl px-4 py-2.5 text-xs"
            style={{ background: t.settingsInputBg, color: t.settingsSubText, border: `1px solid ${t.settingsInputBorder}` }}
          >
            {message}
          </div>
        )}

        {loading ? (
          <p className="text-xs text-center py-10" style={{ color: t.settingsSubText }}>加载中…</p>
        ) : entries.length === 0 ? (
          <p className="text-xs text-center py-10" style={{ color: t.settingsSubText }}>
            还没有日记，点上面"生成今天"写下第一篇吧
          </p>
        ) : (
          <div className="space-y-3">
            {entries.map(entry => (
              <div
                key={entry.id}
                className="rounded-xl px-4 py-3 text-sm"
                style={{ border: `1px solid ${t.settingsInputBorder}`, color: t.settingsText, background: t.settingsInputBg }}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <div className="text-xs font-semibold" style={{ color: t.settingsText }}>{entry.diary_date}</div>
                  <button
                    onClick={async () => {
                      try {
                        const res = await fetch('/api/persona-diary/delete', {
                          method: 'DELETE',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ id: entry.id }),
                        })
                        if (res.ok) {
                          setEntries(prev => prev.filter(d => d.id !== entry.id))
                        }
                      } catch {}
                    }}
                    className="text-xs transition-opacity hover:opacity-70"
                    style={{ color: t.settingsSubText }}
                  >
                    删除
                  </button>
                </div>
                <p className="text-xs leading-relaxed whitespace-pre-wrap" style={{ color: t.settingsSubText }}>{entry.content}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
