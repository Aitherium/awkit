'use client'

import { useState, useEffect, useCallback } from 'react'

export interface DatastoreViewProps {
  apiBase?: string
}

interface Collection {
  name: string
  count?: number
  chunks?: number
}

export default function DatastoreView({ apiBase = '/api/data-plane' }: DatastoreViewProps) {
  const [collections, setCollections] = useState<Collection[]>([])
  const [selectedCol, setSelectedCol] = useState('')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [searching, setSearching] = useState(false)

  const fetchCollections = useCallback(async () => {
    try {
      const resp = await fetch(`${apiBase}/datastore/collections`)
      if (resp.ok) {
        const data = await resp.json()
        setCollections(data.collections || [])
      }
    } catch (e) {
      console.error('Fetch collections error:', e)
    }
    setLoading(false)
  }, [apiBase])

  useEffect(() => { fetchCollections() }, [fetchCollections])

  const handleSearch = async () => {
    if (!query || !selectedCol) return
    setSearching(true)
    try {
      const resp = await fetch(
        `${apiBase}/datastore/${encodeURIComponent(selectedCol)}/query?q=${encodeURIComponent(query)}`
      )
      if (resp.ok) {
        const data = await resp.json()
        setResults(data.results || [])
      }
    } catch {
      setResults([])
    }
    setSearching(false)
  }

  const handleDelete = async (docId: string) => {
    if (!selectedCol) return
    try {
      await fetch(`${apiBase}/datastore/${encodeURIComponent(selectedCol)}/documents/${docId}`, { method: 'DELETE' })
      setResults(r => r.filter(d => d.id !== docId))
    } catch {}
  }

  const exportAs = (format: 'json' | 'csv') => {
    if (results.length === 0) return
    let content: string
    let mime: string
    let ext: string

    if (format === 'json') {
      content = JSON.stringify(results, null, 2)
      mime = 'application/json'
      ext = 'json'
    } else {
      const keys = new Set<string>()
      results.forEach(r => Object.keys(r).forEach(k => keys.add(k)))
      const cols = Array.from(keys)
      const rows = [cols.join(',')]
      results.forEach(r => {
        rows.push(cols.map(c => JSON.stringify(r[c] ?? '')).join(','))
      })
      content = rows.join('\n')
      mime = 'text/csv'
      ext = 'csv'
    }

    const blob = new Blob([content], { type: mime })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${selectedCol}_export.${ext}`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (loading) {
    return <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>Loading datastore...</div>
  }

  return (
    <div>
      {/* Collection selector + search */}
      <div style={{ display: 'flex', gap: 8, marginBottom: '1rem', flexWrap: 'wrap' }}>
        <select
          value={selectedCol}
          onChange={e => { setSelectedCol(e.target.value); setResults([]) }}
          style={{
            padding: '7px 12px', borderRadius: 6, border: '1px solid var(--border)',
            background: 'var(--bg-deep)', color: 'var(--text)', fontSize: '0.85rem',
            cursor: 'pointer', minWidth: 180,
          }}
        >
          <option value="">Select collection...</option>
          {collections.map(c => (
            <option key={c.name} value={c.name}>
              {c.name} {c.count != null ? `(${c.count})` : ''}
            </option>
          ))}
        </select>
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSearch()}
          placeholder="Semantic search query..."
          style={{
            flex: 1, padding: '7px 12px', borderRadius: 6, minWidth: 200,
            border: '1px solid var(--border)', background: 'var(--bg-deep)',
            color: 'var(--text)', fontSize: '0.85rem', boxSizing: 'border-box',
          }}
        />
        <button onClick={handleSearch} disabled={searching || !selectedCol || !query} style={{
          padding: '6px 14px', borderRadius: 6, border: 'none',
          background: 'var(--accent, #7c3aed)', color: '#fff',
          cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600,
          opacity: !selectedCol || !query ? 0.5 : 1,
        }}>
          {searching ? 'Querying...' : 'Query'}
        </button>
      </div>

      {/* Collection info */}
      {collections.length === 0 && (
        <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
          No vector collections found. Upload documents or connect a data source to create collections.
        </div>
      )}

      {selectedCol && collections.length > 0 && (
        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
          Collection: <strong style={{ color: 'var(--text)' }}>{selectedCol}</strong>
          {(() => {
            const col = collections.find(c => c.name === selectedCol)
            return col?.count != null ? ` / ${col.count} documents` : ''
          })()}
        </div>
      )}

      {/* Export buttons */}
      {results.length > 0 && (
        <div style={{ display: 'flex', gap: 6, marginBottom: '1rem' }}>
          <button onClick={() => exportAs('json')} style={exportBtnStyle}>Export JSON</button>
          <button onClick={() => exportAs('csv')} style={exportBtnStyle}>Export CSV</button>
          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', alignSelf: 'center' }}>
            {results.length} results
          </span>
        </div>
      )}

      {/* Results */}
      {results.map((r, i) => {
        const text = r.content || r.text || r.document || ''
        const meta = r.metadata || {}
        return (
          <div key={r.id || i} style={{
            padding: '10px 14px', borderRadius: 8, background: 'var(--bg-elevated)',
            border: '1px solid var(--border)', marginBottom: 6,
          }}>
            <div style={{ fontSize: '0.82rem', color: 'var(--text)', marginBottom: 4 }}>
              {text.slice(0, 400)}{text.length > 400 ? '...' : ''}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {r.score != null && <span>Score: {r.score.toFixed(3)}</span>}
                {meta.file_path && <span>{meta.file_path}</span>}
                {meta.source && <span>Source: {meta.source}</span>}
              </div>
              {r.id && (
                <button
                  onClick={() => handleDelete(r.id)}
                  style={{ padding: '2px 8px', borderRadius: 4, border: '1px solid var(--border)', background: 'transparent', color: '#ff5252', cursor: 'pointer', fontSize: '0.65rem' }}
                >
                  Delete
                </button>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

const exportBtnStyle: React.CSSProperties = {
  padding: '4px 10px', borderRadius: 5, border: '1px solid var(--border, #333)',
  background: 'transparent', color: 'var(--text-muted, #888)', cursor: 'pointer',
  fontSize: '0.7rem',
}
