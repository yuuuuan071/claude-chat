'use client'
import { useEffect, useState } from 'react'
import { type Theme } from '../themes'
import { type Persona, FALLBACK_PERSONAS, adaptPersona } from '../personas'

type MemoryRow = {
  id: string
  persona_id: string
  persona_name: string
  content: string
  source_type: string
  resolution: string
  created_at: string
}

export default function MemoriesView({ theme: t }: { theme: Theme }) {
  const [loading, setLoading] = useState(true)
  const [memories, setMemories] = useState<MemoryRow[]>([])
  const [personas, setPersonas] = useState<Persona[]>([])
  const [personaFilter, setPersonaFilter] = useState('all')
  const [resolutionFilter, setResolutionFilter] = useState('active')
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingText, setEditingText] = useState('')
  const [dirtyPersonaIds, setDirtyPersonaIds] = useState<Set<string>>(new Set())
  const [resummarizingIds, setResummarizingIds] = useState<Set<string>>(new Set())
  const [showBulkConfirm, setShowBulkConfirm] = useState(false)
  const [bulkDeleting, setBulkDeleting] = useState(false)
  const [styleAnchors, setStyleAnchors] = useState<Record<string, string>>({})
  const [editingAnchorId, setEditingAnchorId] = useState<string | null>(null)
  const [anchorDraft, setAnchorDraft] = useState('')
  const [showAnchors, setShowAnchors] = useState(false)
  const [showReviews, setShowReviews] = useState(false)
  const [reviews, setReviews] = useState<Array<{ persona_id: string; review_content: string; created_at: string }>>([])

  const fetchAll = async () => {
    setLoading(true)
    try {
      const [memRes, personaRes] = await Promise.all([
        fetch('/api/persona-memory/list'),
        fetch('/api/personas'),
      ])
      if (memRes.ok) {
        const data = await memRes.json()
        setMemories(data.memories ?? [])
      }
      const merged = new Map<string, Persona>()
      FALLBACK_PERSONAS.forEach(p => merged.set(p.id, adaptPersona(p)))
      if (personaRes.ok) {
        const dbPersonas: Persona[] = await personaRes.json()
        dbPersonas.forEach(p => merged.set(p.id, adaptPersona(p)))
      }
      const personaList = Array.from(merged.values())
      setPersonas(personaList)

      const anchorEntries = await Promise.all(
        personaList.map(async p => {
          try {
            const res = await fetch(`/api/persona-style-anchor?personaId=${p.id}`)
            if (res.ok) {
              const data = await res.json()
              return [p.id, data.content ?? ''] as const
            }
          } catch {}
          return [p.id, ''] as const
        })
      )
      setStyleAnchors(Object.fromEntries(anchorEntries))

      const reviewResults: Array<{ persona_id: string; review_content: string; created_at: string }> = []
      await Promise.all(personaList.map(async (p) => {
        try {
          const res = await fetch(`/api/persona-self-review?personaId=${p.id}`)
          if (res.ok) {
            const data = await res.json()
            if (data.review) {
              reviewResults.push({ persona_id: p.id, review_content: data.review, created_at: '' })
            }
          }
        } catch {}
      }))
      setReviews(reviewResults)
    } catch {}
    setLoading(false)
  }

  useEffect(() => { fetchAll() }, [])

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(timer)
  }, [search])

  const formatDate = (iso: string) => {
    const d = new Date(iso)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }

  const personaName = (id: string) => personas.find(p => p.id === id)?.name ?? id
  const personaColor = (id: string) => personas.find(p => p.id === id)?.color ?? '#8B9BBA'

  const filtered = memories.filter(m =>
    (personaFilter === 'all' || m.persona_id === personaFilter) &&
    (resolutionFilter === 'all' ||
     (resolutionFilter === 'active' ? ['semantic', 'impression', 'detail'].includes(m.resolution) : m.resolution === resolutionFilter)) &&
    (!debouncedSearch.trim() || m.content.toLowerCase().includes(debouncedSearch.trim().toLowerCase()))
  )
  const sorted = [...filtered].sort((a, b) => {
    const diff = new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    return sortOrder === 'asc' ? diff : -diff
  })

  const allVisibleSelected = sorted.length > 0 && sorted.every(m => selectedIds.has(m.id))
  const toggleSelectAll = () => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (allVisibleSelected) sorted.forEach(m => next.delete(m.id))
      else sorted.forEach(m => next.add(m.id))
      return next
    })
  }
  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const startEdit = (m: MemoryRow) => { setEditingId(m.id); setEditingText(m.content) }
  const cancelEdit = () => { setEditingId(null); setEditingText('') }

  const saveEdit = async (m: MemoryRow) => {
    const content = editingText.trim()
    if (!content) return
    try {
      const res = await fetch('/api/persona-memory/update', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: m.id, content }),
      })
      if (res.ok) {
        setMemories(prev => prev.map(mm => mm.id === m.id ? { ...mm, content } : mm))
        setDirtyPersonaIds(prev => new Set(prev).add(m.persona_id))
        cancelEdit()
      }
    } catch {}
  }

  const deleteOne = async (m: MemoryRow) => {
    try {
      const res = await fetch('/api/persona-memory/delete', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: m.id }),
      })
      if (res.ok) {
        setMemories(prev => prev.filter(mm => mm.id !== m.id))
        setSelectedIds(prev => { const next = new Set(prev); next.delete(m.id); return next })
        setDirtyPersonaIds(prev => new Set(prev).add(m.persona_id))
      }
    } catch {}
  }

  const executeBulkDelete = async () => {
    setBulkDeleting(true)
    const targets = memories.filter(m => selectedIds.has(m.id))
    const affected = new Set<string>()
    for (const m of targets) {
      try {
        const res = await fetch('/api/persona-memory/delete', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: m.id }),
        })
        if (res.ok) {
          affected.add(m.persona_id)
          setMemories(prev => prev.filter(mm => mm.id !== m.id))
        }
      } catch {}
    }
    setDirtyPersonaIds(prev => new Set([...prev, ...affected]))
    setSelectedIds(new Set())
    setBulkDeleting(false)
    setShowBulkConfirm(false)
  }

  const regenerateSummary = async (personaId: string) => {
    setResummarizingIds(prev => new Set(prev).add(personaId))
    try {
      const res = await fetch('/api/persona-memory/summarize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ personaId, force: true }),
      })
      if (res.ok) {
        setDirtyPersonaIds(prev => { const next = new Set(prev); next.delete(personaId); return next })
      }
    } catch {}
    setResummarizingIds(prev => { const next = new Set(prev); next.delete(personaId); return next })
  }

  const updateResolution = async (id: string, resolution: string, personaId: string) => {
    try {
      const res = await fetch('/api/persona-memory/update', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, resolution }),
      })
      if (res.ok) {
        setMemories(prev => prev.map(m => m.id === id ? { ...m, resolution } : m))
        setDirtyPersonaIds(prev => new Set(prev).add(personaId))
      }
    } catch {}
  }

  const inputStyle = { background: t.settingsInputBg, color: t.settingsText, border: `1px solid ${t.settingsInputBorder}` }

  return (
    <>
      <div className="flex-1 overflow-y-auto px-4 py-4 max-w-4xl w-full mx-auto space-y-3">
        {/* 工具栏 */}
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={personaFilter}
            onChange={e => setPersonaFilter(e.target.value)}
            className="rounded-xl px-3 py-2 text-xs outline-none cursor-pointer"
            style={inputStyle}
          >
            <option value="all">全部角色</option>
            {personas.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <select
            value={resolutionFilter}
            onChange={e => setResolutionFilter(e.target.value)}
            className="rounded-xl px-3 py-2 text-xs outline-none cursor-pointer"
            style={inputStyle}
          >
            <option value="active">活跃记忆</option>
            <option value="semantic">身份锚点</option>
            <option value="impression">印象</option>
            <option value="detail">细节</option>
            <option value="archived">已归档</option>
            <option value="all">全部</option>
          </select>
          <div className="relative flex-1 min-w-[160px]">
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="搜索记忆内容…"
              className="w-full rounded-xl px-3 py-2 text-xs outline-none pr-7"
              style={inputStyle}
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-xs transition-opacity hover:opacity-70"
                style={{ color: t.settingsSubText }}
              >
                ×
              </button>
            )}
          </div>
          <button
            onClick={() => setSortOrder(o => o === 'desc' ? 'asc' : 'desc')}
            className="text-xs px-3 py-2 rounded-xl transition-opacity hover:opacity-70"
            style={{ color: t.settingsSubText, border: `1px solid ${t.settingsInputBorder}` }}
          >
            {sortOrder === 'desc' ? '时间倒序 ↓' : '时间正序 ↑'}
          </button>
        </div>

        {/* 条目数量统计 */}
        <div className="text-xs" style={{ color: t.settingsSubText }}>
          {sorted.length === memories.length
            ? `共 ${memories.length} 条记忆`
            : `筛选结果 ${sorted.length} / ${memories.length} 条`}
        </div>

        {/* 风格锚定 */}
        <div className="rounded-xl" style={{ border: `1px solid ${t.settingsInputBorder}` }}>
          <button
            onClick={() => setShowAnchors(v => !v)}
            className="w-full flex items-center justify-between px-4 py-2.5 text-xs font-semibold transition-opacity hover:opacity-70"
            style={{ color: t.settingsText }}
          >
            <span>🎙 风格锚定</span>
            <span style={{ fontSize: '10px' }}>{showAnchors ? '▾' : '▸'}</span>
          </button>
          {showAnchors && (
            <div className="px-4 pb-3 space-y-3">
              <p className="text-xs" style={{ color: t.settingsSubText }}>
                为每个角色选一段最能代表其说话风格的回复，作为语感参照。
              </p>
              {personas.map(p => (
                <div key={p.id} className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ background: p.color ?? '#8B9BBA' }} />
                    <span className="text-xs font-medium" style={{ color: t.settingsText }}>{p.name}</span>
                    {editingAnchorId !== p.id && (
                      <button
                        onClick={() => { setEditingAnchorId(p.id); setAnchorDraft(styleAnchors[p.id] ?? '') }}
                        className="text-xs transition-opacity hover:opacity-70 ml-auto"
                        style={{ color: t.settingsSubText }}
                      >
                        {styleAnchors[p.id] ? '编辑' : '添加'}
                      </button>
                    )}
                  </div>
                  {editingAnchorId === p.id ? (
                    <div className="space-y-2">
                      <textarea
                        className="w-full rounded-lg px-3 py-2 text-xs outline-none resize-none leading-relaxed"
                        style={{ ...inputStyle, minHeight: '80px' }}
                        value={anchorDraft}
                        onChange={e => setAnchorDraft(e.target.value)}
                        placeholder="粘贴一段这个角色说得最好的回复…"
                        autoFocus
                      />
                      <div className="flex items-center gap-2">
                        <button
                          onClick={async () => {
                            const content = anchorDraft.trim()
                            if (!content) return
                            try {
                              const res = await fetch('/api/persona-style-anchor', {
                                method: 'PUT',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ personaId: p.id, content }),
                              })
                              if (res.ok) {
                                setStyleAnchors(prev => ({ ...prev, [p.id]: content }))
                                setEditingAnchorId(null)
                              }
                            } catch {}
                          }}
                          disabled={!anchorDraft.trim()}
                          className="text-xs px-3 py-1 rounded-lg transition-opacity hover:opacity-70 disabled:opacity-40"
                          style={{ background: t.userBubble, color: t.headerText }}
                        >
                          保存
                        </button>
                        <button
                          onClick={() => setEditingAnchorId(null)}
                          className="text-xs px-3 py-1 rounded-lg transition-opacity hover:opacity-70"
                          style={{ color: t.settingsSubText }}
                        >
                          取消
                        </button>
                      </div>
                    </div>
                  ) : styleAnchors[p.id] ? (
                    <p className="text-xs leading-relaxed pl-4" style={{ color: t.settingsSubText }}>
                      {styleAnchors[p.id].length > 150 ? styleAnchors[p.id].slice(0, 150) + '…' : styleAnchors[p.id]}
                    </p>
                  ) : (
                    <p className="text-xs pl-4" style={{ color: t.settingsSubText, opacity: 0.5 }}>未设置</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 自省记录 */}
        <div className="rounded-xl" style={{ border: `1px solid ${t.settingsInputBorder}` }}>
          <button
            onClick={() => setShowReviews(v => !v)}
            className="w-full flex items-center justify-between px-4 py-2.5 text-xs font-semibold transition-opacity hover:opacity-70"
            style={{ color: t.settingsText }}
          >
            <span>🪞 自省记录</span>
            <span style={{ fontSize: '10px' }}>{showReviews ? '▾' : '▸'}</span>
          </button>
          {showReviews && (
            <div className="px-4 pb-3 space-y-3">
              <p className="text-xs" style={{ color: t.settingsSubText }}>
                角色对自己回复的反思，会在下次对话中作为参考注入。
              </p>
              {reviews.length === 0 ? (
                <p className="text-xs" style={{ color: t.settingsSubText, opacity: 0.5 }}>暂无自省记录</p>
              ) : (
                reviews.map((r, i) => (
                  <div key={i} className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: personaColor(r.persona_id) }} />
                      <span className="text-xs font-medium" style={{ color: t.settingsText }}>{personaName(r.persona_id)}</span>
                    </div>
                    <p className="text-xs leading-relaxed pl-4" style={{ color: t.settingsSubText }}>
                      {r.review_content}
                    </p>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {/* 选择 / 批量操作栏 */}
        <div className="flex items-center gap-2">
          <button
            onClick={toggleSelectAll}
            disabled={sorted.length === 0}
            className="text-xs px-3 py-1.5 rounded-lg transition-opacity hover:opacity-70 disabled:opacity-40"
            style={{ color: t.settingsSubText, border: `1px solid ${t.settingsInputBorder}` }}
          >
            {allVisibleSelected ? '取消全选' : '全选'}
          </button>
          <span className="text-xs" style={{ color: t.settingsSubText }}>
            已选 {selectedIds.size} 条
          </span>
          <button
            onClick={() => setShowBulkConfirm(true)}
            disabled={selectedIds.size === 0}
            className="text-xs px-3 py-1.5 rounded-lg transition-opacity hover:opacity-70 disabled:opacity-40"
            style={{ background: 'rgba(180,70,70,0.12)', color: '#b34a4a', border: '1px solid rgba(180,70,70,0.3)' }}
          >
            批量删除
          </button>
        </div>

        {/* 摘要过期提示（按角色） */}
        {dirtyPersonaIds.size > 0 && (
          <div className="space-y-2">
            {Array.from(dirtyPersonaIds).map(pid => (
              <div
                key={pid}
                className="rounded-xl px-3 py-2 flex items-center justify-between gap-2"
                style={{ background: t.settingsInputBg, border: `1px solid ${t.settingsInputBorder}` }}
              >
                <span className="text-xs" style={{ color: t.settingsSubText }}>
                  「{personaName(pid)}」记忆已变更，摘要尚未更新
                </span>
                <button
                  onClick={() => regenerateSummary(pid)}
                  disabled={resummarizingIds.has(pid)}
                  className="text-xs px-3 py-1 rounded-lg transition-opacity hover:opacity-70 disabled:opacity-40 shrink-0"
                  style={{ background: t.userBubble, color: t.headerText, border: `1px solid ${t.sendButton}` }}
                >
                  {resummarizingIds.has(pid) ? '生成中…' : '重新生成摘要'}
                </button>
              </div>
            ))}
          </div>
        )}

        {/* 列表 */}
        {loading ? (
          <p className="text-xs text-center py-10" style={{ color: t.settingsSubText }}>加载中…</p>
        ) : sorted.length === 0 ? (
          <p className="text-xs text-center py-10" style={{ color: t.settingsSubText }}>
            {debouncedSearch.trim() || personaFilter !== 'all' || resolutionFilter !== 'active' ? '没有找到匹配的记忆' : '没有符合条件的记忆'}
          </p>
        ) : (
          <div className="space-y-2">
            {sorted.map(m => (
              <div
                key={m.id}
                className="rounded-xl px-4 py-3 text-sm flex gap-3"
                style={{ border: `1px solid ${t.settingsInputBorder}`, color: t.settingsText, background: selectedIds.has(m.id) ? t.userBubble : t.settingsInputBg }}
              >
                <input
                  type="checkbox"
                  checked={selectedIds.has(m.id)}
                  onChange={() => toggleSelect(m.id)}
                  className="mt-1 shrink-0 cursor-pointer"
                />
                <div className="flex-1 min-w-0">
                  {editingId === m.id ? (
                    <div className="space-y-2">
                      <textarea
                        className="w-full rounded-lg px-3 py-2 text-sm outline-none resize-none leading-relaxed"
                        style={{ ...inputStyle, minHeight: '60px' }}
                        value={editingText}
                        onChange={e => setEditingText(e.target.value)}
                        autoFocus
                      />
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => saveEdit(m)}
                          disabled={!editingText.trim()}
                          className="text-xs px-3 py-1 rounded-lg transition-opacity hover:opacity-70 disabled:opacity-40"
                          style={{ background: t.userBubble, color: t.headerText, border: `1px solid ${t.sendButton}` }}
                        >
                          保存
                        </button>
                        <button
                          onClick={cancelEdit}
                          className="text-xs px-3 py-1 rounded-lg transition-opacity hover:opacity-70"
                          style={{ color: t.settingsSubText, border: `1px solid ${t.settingsInputBorder}` }}
                        >
                          取消
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <p className="leading-relaxed">{m.content}</p>
                      <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                        <span className="text-xs px-2 py-0.5 rounded-full flex items-center gap-1" style={{ background: t.settingsInputBg, color: t.settingsSubText }}>
                          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: personaColor(m.persona_id) }} />
                          {m.persona_name}
                        </span>
                        <span className="text-xs" style={{ color: t.settingsSubText }}>{formatDate(m.created_at)}</span>
                        <span className="text-xs" style={{ color: t.settingsSubText }}>· {m.source_type === 'manual_import' ? '手动' : '自动'}</span>
                        <span className="text-xs px-2 py-0.5 rounded-full" style={{
                          background: m.resolution === 'semantic' ? 'rgba(100,180,100,0.15)' :
                                      m.resolution === 'impression' ? 'rgba(100,150,200,0.15)' :
                                      m.resolution === 'archived' ? 'rgba(150,150,150,0.15)' :
                                      'rgba(200,170,100,0.15)',
                          color: m.resolution === 'semantic' ? '#5a9a5a' :
                                 m.resolution === 'impression' ? '#5a8ab5' :
                                 m.resolution === 'archived' ? '#888' :
                                 '#b5993a'
                        }}>
                          {m.resolution === 'semantic' ? '身份' : m.resolution === 'impression' ? '印象' : m.resolution === 'detail' ? '细节' : '归档'}
                        </span>
                        <span className="flex-1" />
                        <button onClick={() => startEdit(m)} className="text-xs transition-opacity hover:opacity-70" style={{ color: t.settingsSubText }}>编辑</button>
                        {m.resolution !== 'semantic' && m.resolution !== 'archived' && (
                          <button onClick={() => updateResolution(m.id, 'semantic', m.persona_id)} className="text-xs transition-opacity hover:opacity-70" style={{ color: '#5a9a5a' }}>设为身份</button>
                        )}
                        {m.resolution !== 'archived' && (
                          <button onClick={() => updateResolution(m.id, 'archived', m.persona_id)} className="text-xs transition-opacity hover:opacity-70" style={{ color: '#888' }}>归档</button>
                        )}
                        <button onClick={() => deleteOne(m)} className="text-xs transition-opacity hover:opacity-70" style={{ color: t.settingsSubText }}>删除</button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 批量删除确认弹窗 */}
      {showBulkConfirm && (
        <div className="fixed inset-0 flex items-center justify-center z-50" style={{ background: t.overlayBg, backdropFilter: 'blur(4px)' }}>
          <div className="rounded-2xl w-full mx-4 p-6" style={{ background: t.settingsBg, backdropFilter: 'blur(16px)', maxWidth: '360px' }}>
            <p className="text-sm mb-1" style={{ color: t.settingsText }}>确定删除选中的 {selectedIds.size} 条记忆？</p>
            <p className="text-xs mb-5" style={{ color: t.settingsSubText }}>此操作不可撤销。</p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowBulkConfirm(false)}
                disabled={bulkDeleting}
                className="text-xs px-4 py-2 rounded-xl transition-opacity hover:opacity-70 disabled:opacity-40"
                style={{ color: t.settingsSubText }}
              >
                取消
              </button>
              <button
                onClick={executeBulkDelete}
                disabled={bulkDeleting}
                className="text-xs px-4 py-2 rounded-xl transition-opacity hover:opacity-70 disabled:opacity-40"
                style={{ background: '#b34a4a', color: '#fff' }}
              >
                {bulkDeleting ? '删除中…' : '确认删除'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
