'use client'

/**
 * PostComposerPanel — Rich post creation with cross-platform preview.
 *
 * Text editor with live char count, platform selectors, per-platform preview,
 * AI content generation, schedule picker, publish/draft actions.
 */

import { useState, useEffect } from 'react'

interface PlatformInfo {
  id: string
  display_name: string
  char_limit: number | null
  status: string
  color: string
}

export interface PostComposerPanelProps {
  apiBase?: string
  onPublished?: () => void
}

const DEFAULT_PLATFORMS: PlatformInfo[] = [
  { id: 'bluesky', display_name: 'Bluesky', char_limit: 300, status: 'active', color: '#0085FF' },
  { id: 'linkedin', display_name: 'LinkedIn', char_limit: 3000, status: 'active', color: '#0A66C2' },
  { id: 'email', display_name: 'Email', char_limit: null, status: 'active', color: '#10B981' },
]

export default function PostComposerPanel({
  apiBase = '/api/social',
  onPublished,
}: PostComposerPanelProps) {
  const [text, setText] = useState('')
  const [platforms, setPlatforms] = useState<PlatformInfo[]>(DEFAULT_PLATFORMS)
  const [selectedPlatforms, setSelectedPlatforms] = useState<Set<string>>(new Set(['bluesky', 'linkedin']))
  const [scheduleDate, setScheduleDate] = useState('')
  const [scheduleTime, setScheduleTime] = useState('')
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState<{ status: string; id?: string } | null>(null)
  const [aiLoading, setAiLoading] = useState(false)

  useEffect(() => {
    fetch(`${apiBase}/platforms`)
      .then(r => r.json())
      .then(d => {
        const plats = d.platforms || d
        if (Array.isArray(plats) && plats.length > 0) setPlatforms(plats)
      })
      .catch(() => {})
  }, [apiBase])

  const togglePlatform = (id: string) => {
    setSelectedPlatforms(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleSave = async (action: 'draft' | 'publish' | 'schedule') => {
    setSaving(true)
    setResult(null)
    const body: any = {
      text,
      platforms: Array.from(selectedPlatforms),
    }
    if (action === 'schedule' && scheduleDate) {
      body.schedule_time = `${scheduleDate}T${scheduleTime || '09:00'}:00Z`
    }

    try {
      const res = await fetch(`${apiBase}/posts/draft`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      const postId = data.id

      if (action === 'publish' && postId) {
        await fetch(`${apiBase}/posts/${postId}/publish`, { method: 'POST' })
        setResult({ status: 'Published', id: postId })
      } else if (action === 'schedule' && postId) {
        await fetch(`${apiBase}/posts/${postId}/schedule`, { method: 'POST' })
        setResult({ status: 'Scheduled', id: postId })
      } else {
        setResult({ status: 'Draft saved', id: postId })
      }
      onPublished?.()
    } catch {
      setResult({ status: 'Error saving post' })
    }
    setSaving(false)
  }

  const handleAI = async () => {
    setAiLoading(true)
    try {
      const res = await fetch('/api/content/caption', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic: text || 'Our latest product update',
          count: 1,
          platforms: Array.from(selectedPlatforms),
        }),
      })
      const data = await res.json()
      const caption = data.captions?.[0] || data.caption || data.text
      if (caption) setText(caption)
    } catch {
      // AI not available, silently ignore
    }
    setAiLoading(false)
  }

  const activePlatforms = platforms.filter(p => p.status === 'active')

  return (
    <div style={{ padding: 32, maxWidth: 900, margin: '0 auto' }}>
      <h1 style={{ fontSize: '1.4rem', fontWeight: 600, marginBottom: 24 }}>Compose Post</h1>

      {/* Platform selector */}
      <div style={{ marginBottom: 20 }}>
        <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 8 }}>
          Platforms
        </label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {activePlatforms.map(p => {
            const sel = selectedPlatforms.has(p.id)
            return (
              <button
                key={p.id}
                onClick={() => togglePlatform(p.id)}
                style={{
                  padding: '8px 16px', borderRadius: 'var(--radius)',
                  background: sel ? p.color : 'var(--bg-base)',
                  color: sel ? 'white' : 'var(--text-secondary)',
                  border: `1px solid ${sel ? p.color : 'var(--glass-border)'}`,
                  fontSize: '0.8rem', cursor: 'pointer', fontWeight: sel ? 600 : 400,
                  transition: 'all 0.15s',
                }}
              >
                {p.display_name}
                {p.char_limit && <span style={{ opacity: 0.7, marginLeft: 6, fontSize: '0.7rem' }}>({p.char_limit})</span>}
              </button>
            )
          })}
        </div>
      </div>

      {/* Text editor */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Content</label>
          <button
            onClick={handleAI}
            disabled={aiLoading}
            style={{
              padding: '4px 12px', fontSize: '0.7rem', borderRadius: 'var(--radius)',
              background: 'var(--bg-surface)', border: '1px solid var(--glass-border)',
              color: 'var(--accent-primary)', cursor: 'pointer',
            }}
          >
            {aiLoading ? 'Generating...' : 'AI Generate'}
          </button>
        </div>
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder="What do you want to share?"
          rows={6}
          style={{
            width: '100%', padding: 14, fontSize: '0.85rem', lineHeight: 1.6,
            borderRadius: 'var(--radius)', border: '1px solid var(--glass-border)',
            background: 'var(--bg-base)', color: 'var(--text-primary)',
            resize: 'vertical', fontFamily: 'inherit',
          }}
        />
        {/* Per-platform char count */}
        <div style={{ display: 'flex', gap: 12, marginTop: 6, flexWrap: 'wrap' }}>
          {activePlatforms.filter(p => selectedPlatforms.has(p.id) && p.char_limit).map(p => {
            const over = p.char_limit! > 0 && text.length > p.char_limit!
            return (
              <span key={p.id} style={{ fontSize: '0.7rem', color: over ? '#EF4444' : 'var(--text-muted)' }}>
                {p.display_name}: {text.length}/{p.char_limit}
              </span>
            )
          })}
        </div>
      </div>

      {/* Platform previews */}
      {text && selectedPlatforms.size > 0 && (
        <div style={{ marginBottom: 20 }}>
          <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 8 }}>Preview</label>
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(selectedPlatforms.size, 3)}, 1fr)`, gap: 12 }}>
            {activePlatforms.filter(p => selectedPlatforms.has(p.id)).map(p => {
              const limit = p.char_limit
              const preview = limit && text.length > limit ? text.slice(0, limit - 3) + '...' : text
              return (
                <div key={p.id} style={{
                  background: 'var(--bg-base)', borderRadius: 'var(--radius)',
                  border: `1px solid ${p.color}33`, padding: 14, overflow: 'hidden',
                }}>
                  <div style={{
                    fontSize: '0.7rem', fontWeight: 600, color: p.color,
                    marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6,
                  }}>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: p.color }} />
                    {p.display_name}
                  </div>
                  <p style={{ fontSize: '0.8rem', lineHeight: 1.5, color: 'var(--text-primary)', wordBreak: 'break-word' }}>{preview}</p>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Schedule */}
      <div style={{ marginBottom: 24 }}>
        <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 8 }}>Schedule (optional)</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input type="date" value={scheduleDate} onChange={e => setScheduleDate(e.target.value)}
            style={inputStyle} />
          <input type="time" value={scheduleTime} onChange={e => setScheduleTime(e.target.value)}
            style={inputStyle} />
        </div>
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 10 }}>
        <button onClick={() => handleSave('draft')} disabled={!text || saving}
          style={{ ...actionBtn, background: 'var(--bg-surface)', color: 'var(--text-primary)', border: '1px solid var(--glass-border)' }}>
          Save Draft
        </button>
        {scheduleDate && (
          <button onClick={() => handleSave('schedule')} disabled={!text || saving}
            style={{ ...actionBtn, background: '#0A66C2', color: 'white' }}>
            Schedule
          </button>
        )}
        <button onClick={() => handleSave('publish')} disabled={!text || saving || selectedPlatforms.size === 0}
          style={{ ...actionBtn, background: 'var(--accent-primary)', color: 'white' }}>
          {saving ? 'Publishing...' : 'Publish Now'}
        </button>
      </div>

      {result && (
        <div style={{
          marginTop: 16, padding: '10px 14px', borderRadius: 'var(--radius)',
          background: result.status === 'Error saving post' ? '#FEE2E2' : '#D1FAE5',
          color: result.status === 'Error saving post' ? '#991B1B' : '#065F46',
          fontSize: '0.8rem',
        }}>
          {result.status}{result.id ? ` (ID: ${result.id})` : ''}
        </div>
      )}
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  padding: '8px 12px', fontSize: '0.8rem', borderRadius: 'var(--radius)',
  border: '1px solid var(--glass-border)', background: 'var(--bg-base)',
  color: 'var(--text-primary)',
}

const actionBtn: React.CSSProperties = {
  padding: '10px 20px', borderRadius: 'var(--radius)',
  fontSize: '0.85rem', fontWeight: 500, cursor: 'pointer',
  border: 'none',
}
