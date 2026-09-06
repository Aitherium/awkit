'use client'

import { useEffect, useState } from 'react'
import { useAuth } from '../hooks/useAuth'

interface Preference {
  id: string
  category: string
  key: string
  value: string
  reasoning: string | null
  created_at: string | null
  /** 'workspace' (applies to everyone) or 'user' (personal). */
  scope?: string
  owner?: string
}

export interface PreferencesPanelProps {
  apiBase?: string
}

export default function PreferencesPanel({ apiBase = '/api/feedback/preferences' }: PreferencesPanelProps) {
  const { user } = useAuth()
  const isAdmin = (user as any)?.role === 'admin'
  const [prefs, setPrefs] = useState<Preference[]>([])
  const [adding, setAdding] = useState(false)
  const [category, setCategory] = useState('writing_style')
  const [key, setKey] = useState('')
  const [value, setValue] = useState('')
  const [scope, setScope] = useState<'user' | 'workspace'>('user')

  const fetchPrefs = () => {
    fetch(apiBase)
      .then(r => r.json())
      .then((data: Preference[]) => setPrefs(Array.isArray(data) ? data.slice(0, 8) : []))
      .catch(() => {})
  }

  useEffect(() => { fetchPrefs() }, [apiBase])

  const addPref = async () => {
    if (!key.trim() || !value.trim()) return
    await fetch(apiBase, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category, key, value, scope }),
    })
    setKey('')
    setValue('')
    setScope('user')
    setAdding(false)
    fetchPrefs()
  }

  const removePref = async (id: string) => {
    try { await fetch(`${apiBase}/${id}`, { method: 'DELETE' }) } catch {}
    fetchPrefs()
  }

  return (
    <div style={{ padding: '0.75rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
        <h3 style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
          What I've Learned
        </h3>
        <button
          onClick={() => setAdding(!adding)}
          style={{
            padding: '0.15rem 0.4rem',
            background: 'var(--bg-elevated)',
            color: 'var(--text-secondary)',
            borderRadius: 4,
            fontSize: '0.65rem',
          }}
        >
          + Add
        </button>
      </div>

      {adding && (
        <div style={{
          marginBottom: '0.5rem',
          padding: '0.5rem',
          background: 'var(--bg-surface)',
          borderRadius: 6,
          display: 'flex',
          flexDirection: 'column',
          gap: '0.3rem',
        }}>
          <select
            value={category}
            onChange={e => setCategory(e.target.value)}
            style={{
              padding: '0.3rem',
              background: 'var(--bg-elevated)',
              color: 'var(--text-primary)',
              border: '1px solid var(--glass-border)',
              borderRadius: 4,
              fontSize: '0.7rem',
            }}
          >
            <option value="writing_style">Writing Style</option>
            <option value="staff_selection">Staff Selection</option>
            <option value="project_selection">Project Selection</option>
            <option value="formatting">Formatting</option>
            <option value="persona">Persona / Tone</option>
            <option value="rules">Rules</option>
            <option value="general">General</option>
          </select>
          <input
            value={key}
            onChange={e => setKey(e.target.value)}
            placeholder="Preference (e.g. 'resume length')"
            style={inputStyle}
          />
          <input
            value={value}
            onChange={e => setValue(e.target.value)}
            placeholder="Value (e.g. '2 pages max')"
            onKeyDown={e => e.key === 'Enter' && addPref()}
            style={inputStyle}
          />
          {isAdmin && (
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.68rem', color: 'var(--text-muted)', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={scope === 'workspace'}
                onChange={e => setScope(e.target.checked ? 'workspace' : 'user')}
              />
              Workspace-wide (applies to everyone)
            </label>
          )}
          <button
            onClick={addPref}
            style={{
              padding: '0.3rem 0.6rem',
              background: 'var(--accent-primary)',
              color: 'var(--bg-deep)',
              borderRadius: 4,
              fontSize: '0.7rem',
              fontWeight: 600,
              alignSelf: 'flex-start',
            }}
          >
            Save
          </button>
        </div>
      )}

      {prefs.length === 0 && (
        <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
          No preferences yet. Rate responses (thumbs under each reply) to train me,
          or add one with + Add.
        </p>
      )}

      {prefs.map(p => (
        <div key={p.id} style={{
          padding: '0.3rem 0',
          borderBottom: '1px solid var(--glass-border)',
          fontSize: '0.75rem',
          display: 'flex',
          alignItems: 'baseline',
          gap: '0.3rem',
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            {p.scope === 'workspace' && (
              <span title="Applies to everyone in the workspace"
                style={{ color: 'var(--accent-amber, #f59e0b)', marginRight: '0.3rem', fontSize: '0.65rem', fontWeight: 700 }}>
                WS
              </span>
            )}
            <span style={{ color: 'var(--accent-cyan)', marginRight: '0.3rem' }}>[{p.category}]</span>
            <span style={{ color: 'var(--text-secondary)' }}>{p.key}:</span>
            {' '}
            <span>{p.value}</span>
          </div>
          <button
            onClick={() => removePref(p.id)}
            title="Remove"
            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.7rem', flexShrink: 0 }}
          >
            x
          </button>
        </div>
      ))}
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  padding: '0.3rem 0.5rem',
  background: 'var(--bg-elevated)',
  color: 'var(--text-primary)',
  border: '1px solid var(--glass-border)',
  borderRadius: 4,
  fontSize: '0.7rem',
}
