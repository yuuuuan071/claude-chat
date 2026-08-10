'use client'
import { useEffect, useState } from 'react'
import { type Theme } from '../themes'
import { type Persona, FALLBACK_PERSONAS, adaptPersona } from '../personas'

type Letter = {
  id: string
  persona_id: string
  content: string
  is_read: boolean
  created_at: string
}

export default function LettersView({ theme: t, onUnreadChange }: { theme: Theme; onUnreadChange?: (count: number) => void }) {
  const [letters, setLetters] = useState<Letter[]>([])
  const [loading, setLoading] = useState(true)
  const [personaFilter, setPersonaFilter] = useState<'all' | string>('all')
  const [allPersonas, setAllPersonas] = useState<Persona[]>([])

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      try {
        const [personaRes, letterRes] = await Promise.all([
          fetch('/api/personas'),
          fetch('/api/persona-letters/list'),
        ])
        const merged = new Map<string, Persona>()
        FALLBACK_PERSONAS.forEach(p => merged.set(p.id, adaptPersona(p)))
        if (personaRes.ok) {
          const dbPersonas: Persona[] = await personaRes.json()
          dbPersonas.forEach(p => merged.set(p.id, adaptPersona(p)))
        }
        setAllPersonas(Array.from(merged.values()))

        if (letterRes.ok) {
          const data = await letterRes.json()
          setLetters(data.letters ?? [])
        }
      } catch {}
      setLoading(false)
    }
    load()
  }, [])

  const personaName = (id: string) => allPersonas.find(p => p.id === id)?.name ?? id
  const personaColor = (id: string) => allPersonas.find(p => p.id === id)?.color ?? '#8B9BBA'

  const formatDate = (iso: string) => {
    const d = new Date(iso)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }

  const markRead = async (letter: Letter) => {
    if (letter.is_read) return
    try {
      const res = await fetch('/api/persona-letters/read', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: letter.id }),
      })
      if (res.ok) {
        setLetters(prev => {
          const next = prev.map(l => l.id === letter.id ? { ...l, is_read: true } : l)
          onUnreadChange?.(next.filter(l => !l.is_read).length)
          return next
        })
      }
    } catch {}
  }

  const filtered = personaFilter === 'all' ? letters : letters.filter(l => l.persona_id === personaFilter)

  const inputStyle = { background: t.settingsInputBg, color: t.settingsText, border: `1px solid ${t.settingsInputBorder}` }

  return (
    <div className="px-4 py-4 max-w-2xl w-full mx-auto space-y-3">
      {/* 工具栏 */}
      <div className="flex items-center gap-2">
        <select
          value={personaFilter}
          onChange={e => setPersonaFilter(e.target.value)}
          className="rounded-xl px-3 py-2 text-xs outline-none cursor-pointer"
          style={inputStyle}
        >
          <option value="all">全部角色</option>
          {allPersonas.map(p => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>

      {loading ? (
        <p className="text-xs text-center py-10" style={{ color: t.settingsSubText }}>加载中…</p>
      ) : filtered.length === 0 ? (
        <p className="text-xs text-center py-10" style={{ color: t.settingsSubText }}>还没有来信</p>
      ) : (
        <div className="space-y-2">
          {filtered.map(letter => (
            <div
              key={letter.id}
              onClick={() => markRead(letter)}
              className="rounded-xl px-4 py-3 text-sm flex gap-2 cursor-pointer"
              style={{
                border: `1px solid ${t.settingsInputBorder}`,
                borderLeft: letter.is_read ? 'none' : `3px solid ${t.sendButton}`,
                color: t.settingsText,
                background: t.settingsInputBg,
              }}
            >
              {!letter.is_read && (
                <span className="w-1.5 h-1.5 rounded-full shrink-0 mt-1.5" style={{ background: '#3b82f6' }} />
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: personaColor(letter.persona_id) }} />
                  <span className="text-xs font-semibold" style={{ color: t.settingsText }}>{personaName(letter.persona_id)}</span>
                  <span className="text-xs" style={{ color: t.settingsSubText }}>{formatDate(letter.created_at)}</span>
                </div>
                <p className="text-xs leading-relaxed whitespace-pre-wrap" style={{ color: t.settingsSubText }}>{letter.content}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
