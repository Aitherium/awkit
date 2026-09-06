'use client'

import { useState, useEffect } from 'react'
import { BookOpen, Plus, Play, Settings2, Trash2 } from 'lucide-react'

export interface NotebooksPanelProps {
  apiBase?: string
}

interface Notebook {
  id?: string
  name: string
  description?: string
  status?: string
  created_by?: string
  created_at?: string
  tags?: string[]
}

export default function NotebooksPanel({ apiBase = '' }: NotebooksPanelProps) {
  const [notebooks, setNotebooks] = useState<Notebook[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const fetchNotebooks = async () => {
      try {
        setLoading(true)
        setError(null)
        const url = new URL(`${apiBase}/api/notebooks`, typeof window !== 'undefined' ? window.location.origin : 'http://localhost')
        const response = await fetch(url.toString())

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`)
        }

        const data = await response.json()
        setNotebooks(Array.isArray(data?.notebooks) ? data.notebooks : [])
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load notebooks')
        setNotebooks([])
      } finally {
        setLoading(false)
      }
    }

    fetchNotebooks()
  }, [apiBase])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: '1.5rem' }}>
      <div style={{ marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <BookOpen style={{ width: '24px', height: '24px', color: 'var(--text-secondary)' }} />
            <h2 style={{ fontSize: '1.2rem', fontWeight: 700, margin: 0 }}>Agent Notebooks</h2>
          </div>
          <button
            style={{
              padding: '0.5rem 1rem',
              borderRadius: 'var(--radius)',
              background: 'var(--accent-primary)',
              color: '#fff',
              border: 'none',
              fontSize: '0.85rem',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
            }}
            onMouseEnter={(e) => {
              (e.target as HTMLButtonElement).style.opacity = '0.9'
            }}
            onMouseLeave={(e) => {
              (e.target as HTMLButtonElement).style.opacity = '1'
            }}
          >
            <Plus style={{ width: '16px', height: '16px' }} />
            New Notebook
          </button>
        </div>
        <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: 0 }}>
          Structured execution plans with cells, variables, and checkpoints
        </p>
      </div>

      {loading && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1 }}>
          <div style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
            <div style={{ fontSize: '0.9rem', marginBottom: '0.5rem' }}>Loading notebooks...</div>
          </div>
        </div>
      )}

      {error && (
        <div
          style={{
            padding: '1rem',
            background: 'rgba(220, 38, 38, 0.1)',
            border: '1px solid rgba(220, 38, 38, 0.3)',
            borderRadius: 'var(--radius)',
            color: 'var(--accent-coral)',
            fontSize: '0.85rem',
          }}
        >
          Error loading notebooks: {error}
        </div>
      )}

      {!loading && !error && notebooks.length === 0 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1 }}>
          <div style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
            <BookOpen style={{ width: '48px', height: '48px', opacity: 0.5, margin: '0 auto 1rem' }} />
            <div style={{ fontSize: '0.9rem', marginBottom: '0.5rem' }}>No notebooks yet</div>
            <div style={{ fontSize: '0.8rem', opacity: 0.7 }}>Create a new notebook to get started</div>
          </div>
        </div>
      )}

      {!loading && !error && notebooks.length > 0 && (
        <div style={{ flex: 1, overflow: 'auto' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1rem' }}>
            {notebooks.map((nb) => (
              <div
                key={nb.id || nb.name}
                style={{
                  padding: '1rem',
                  background: 'var(--bg-surface)',
                  border: '1px solid var(--glass-border)',
                  borderRadius: 'var(--radius)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.75rem',
                  transition: 'all 0.2s ease',
                  cursor: 'pointer',
                }}
                onMouseEnter={(e) => {
                  const el = e.currentTarget as HTMLDivElement
                  el.style.borderColor = 'var(--accent-primary)'
                  el.style.background = 'var(--bg-elevated)'
                }}
                onMouseLeave={(e) => {
                  const el = e.currentTarget as HTMLDivElement
                  el.style.borderColor = 'var(--glass-border)'
                  el.style.background = 'var(--bg-surface)'
                }}
              >
                <div>
                  <h3 style={{ fontSize: '0.95rem', fontWeight: 600, margin: '0 0 0.25rem 0' }}>
                    {nb.name}
                  </h3>
                  {nb.description && (
                    <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: 0 }}>
                      {nb.description}
                    </p>
                  )}
                </div>

                {nb.tags && nb.tags.length > 0 && (
                  <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                    {nb.tags.slice(0, 3).map((tag) => (
                      <span
                        key={tag}
                        style={{
                          fontSize: '0.7rem',
                          padding: '0.25rem 0.5rem',
                          background: 'var(--bg-elevated)',
                          borderRadius: '0.25rem',
                          color: 'var(--text-secondary)',
                        }}
                      >
                        {tag}
                      </span>
                    ))}
                    {nb.tags.length > 3 && (
                      <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                        +{nb.tags.length - 3}
                      </span>
                    )}
                  </div>
                )}

                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  {nb.created_by && <div>by {nb.created_by}</div>}
                  {nb.status && <div>Status: {nb.status}</div>}
                </div>

                <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                  <button
                    style={{
                      flex: 1,
                      padding: '0.4rem 0.75rem',
                      background: 'var(--accent-primary)',
                      color: '#fff',
                      border: 'none',
                      borderRadius: '0.25rem',
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '0.4rem',
                    }}
                  >
                    <Play style={{ width: '12px', height: '12px' }} />
                    Open
                  </button>
                  <button
                    style={{
                      padding: '0.4rem 0.6rem',
                      background: 'transparent',
                      border: '1px solid var(--glass-border)',
                      borderRadius: '0.25rem',
                      cursor: 'pointer',
                      color: 'var(--text-secondary)',
                    }}
                  >
                    <Settings2 style={{ width: '12px', height: '12px' }} />
                  </button>
                  <button
                    style={{
                      padding: '0.4rem 0.6rem',
                      background: 'transparent',
                      border: '1px solid var(--glass-border)',
                      borderRadius: '0.25rem',
                      cursor: 'pointer',
                      color: 'var(--text-secondary)',
                    }}
                  >
                    <Trash2 style={{ width: '12px', height: '12px' }} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
