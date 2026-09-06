'use client'

import { useState, useEffect, useCallback } from 'react'

/* ── Types ─────────────────────────────────────────────────────────── */

interface Secret {
  key: string
  description?: string
  tags?: string[]
  created_at: string
  rotated_at?: string
}

interface SecretValue {
  key: string
  value: string
}

interface UsageEntry {
  accessor: string
  action: string
  timestamp: string
  ip_address?: string
}

export interface SecretsPanelProps {
  apiBase?: string
}

/* ── Styles ────────────────────────────────────────────────────────── */

const sBtn = (primary = false): React.CSSProperties => ({
  padding: '6px 14px', borderRadius: 6,
  border: primary ? 'none' : '1px solid var(--border)',
  background: primary ? 'var(--accent)' : 'transparent',
  color: primary ? '#fff' : 'var(--text-muted)',
  cursor: 'pointer', fontSize: '0.8rem', fontWeight: primary ? 600 : 400,
})

const sBtnDanger: React.CSSProperties = {
  padding: '6px 14px', borderRadius: 6, border: 'none',
  background: '#dc2626', color: '#fff', cursor: 'pointer',
  fontSize: '0.8rem', fontWeight: 600,
}

const sInput: React.CSSProperties = {
  padding: '8px 12px', borderRadius: 6,
  border: '1px solid var(--border)', background: 'var(--bg-deep)',
  color: 'var(--text)', width: '100%', boxSizing: 'border-box',
}

const sCard: React.CSSProperties = {
  padding: '12px 16px', borderRadius: 8,
  background: 'var(--bg-elevated)', border: '1px solid var(--border)',
}

/* ── Component ─────────────────────────────────────────────────────── */

export default function SecretsPanel({ apiBase = '/api/secrets' }: SecretsPanelProps) {
  const [secrets, setSecrets] = useState<Secret[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [revealedValue, setRevealedValue] = useState<string | null>(null)
  const [revealedKey, setRevealedKey] = useState<string | null>(null)
  const [usageLog, setUsageLog] = useState<UsageEntry[]>([])

  // Create form
  const [showCreate, setShowCreate] = useState(false)
  const [newKey, setNewKey] = useState('')
  const [newValue, setNewValue] = useState('')
  const [newDescription, setNewDescription] = useState('')
  const [newTags, setNewTags] = useState('')

  // Edit form
  const [editKey, setEditKey] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')

  // Delete confirmation
  const [deleteKey, setDeleteKey] = useState<string | null>(null)

  // Import
  const [showImport, setShowImport] = useState(false)
  const [importText, setImportText] = useState('')

  /* ── Data Fetching ───────────────────────────────────────────── */

  const fetchSecrets = useCallback(async () => {
    setLoading(true)
    try {
      const resp = await fetch(`${apiBase}`)
      if (resp.ok) {
        const data = await resp.json()
        setSecrets(data?.data?.secrets ?? data?.secrets ?? [])
      }
    } catch (e) {
      console.error('Secrets fetch error:', e)
    }
    setLoading(false)
  }, [apiBase])

  const fetchUsage = useCallback(async (key: string) => {
    try {
      const resp = await fetch(`${apiBase}/${encodeURIComponent(key)}/usage`)
      if (resp.ok) {
        const data = await resp.json()
        setUsageLog(data?.data?.entries ?? data?.entries ?? [])
      }
    } catch (e) {
      console.error('Usage fetch error:', e)
      setUsageLog([])
    }
  }, [apiBase])

  useEffect(() => { fetchSecrets() }, [fetchSecrets])

  /* ── Actions ─────────────────────────────────────────────────── */

  const handleReveal = async (key: string) => {
    if (revealedKey === key) {
      setRevealedKey(null)
      setRevealedValue(null)
      return
    }
    try {
      const resp = await fetch(`${apiBase}/${encodeURIComponent(key)}`)
      if (resp.ok) {
        const data = await resp.json()
        setRevealedValue(data?.data?.value ?? data?.value ?? '***')
        setRevealedKey(key)
      }
    } catch (e) {
      console.error('Reveal secret error:', e)
    }
  }

  const handleCreate = async () => {
    if (!newKey || !newValue) return
    try {
      const resp = await fetch(`${apiBase}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key: newKey,
          value: newValue,
          description: newDescription || undefined,
          tags: newTags ? newTags.split(',').map(t => t.trim()) : [],
        }),
      })
      if (resp.ok) {
        setShowCreate(false)
        setNewKey(''); setNewValue(''); setNewDescription(''); setNewTags('')
        fetchSecrets()
      }
    } catch (e) {
      console.error('Create secret error:', e)
    }
  }

  const handleUpdate = async () => {
    if (!editKey || !editValue) return
    try {
      const resp = await fetch(`${apiBase}/${encodeURIComponent(editKey)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: editValue }),
      })
      if (resp.ok) {
        setEditKey(null); setEditValue('')
        setRevealedKey(null); setRevealedValue(null)
        fetchSecrets()
      }
    } catch (e) {
      console.error('Update secret error:', e)
    }
  }

  const handleRotate = async (key: string) => {
    try {
      const resp = await fetch(`${apiBase}/${encodeURIComponent(key)}/rotate`, { method: 'POST' })
      if (resp.ok) {
        setRevealedKey(null); setRevealedValue(null)
        fetchSecrets()
      }
    } catch (e) {
      console.error('Rotate secret error:', e)
    }
  }

  const handleDelete = async (key: string) => {
    try {
      const resp = await fetch(`${apiBase}/${encodeURIComponent(key)}`, { method: 'DELETE' })
      if (resp.ok) {
        setDeleteKey(null); setSelectedKey(null)
        setRevealedKey(null); setRevealedValue(null)
        fetchSecrets()
      }
    } catch (e) {
      console.error('Delete secret error:', e)
    }
  }

  const handleImport = async () => {
    if (!importText.trim()) return
    try {
      const resp = await fetch(`${apiBase}/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ env_content: importText }),
      })
      if (resp.ok) {
        setShowImport(false); setImportText('')
        fetchSecrets()
      }
    } catch (e) {
      console.error('Import secrets error:', e)
    }
  }

  const handleExport = async () => {
    try {
      const resp = await fetch(`${apiBase}/export`)
      if (resp.ok) {
        const data = await resp.json()
        const content = data?.data?.env_content ?? data?.env_content ?? ''
        const blob = new Blob([content], { type: 'text/plain' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url; a.download = 'secrets.env'; a.click()
        URL.revokeObjectURL(url)
      }
    } catch (e) {
      console.error('Export secrets error:', e)
    }
  }

  /* ── Helpers ─────────────────────────────────────────────────── */

  const formatDate = (iso: string) => {
    try {
      return new Date(iso).toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric',
      })
    } catch { return iso }
  }

  const formatTimestamp = (iso: string) => {
    try {
      return new Date(iso).toLocaleString('en-US', {
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true,
      })
    } catch { return iso }
  }

  const maskValue = (val: string) => '\u2022'.repeat(Math.min(val?.length || 8, 24))

  /* ── Render ──────────────────────────────────────────────────── */

  if (loading) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
        Loading secrets...
      </div>
    )
  }

  return (
    <div style={{ padding: '1.5rem', maxWidth: 960, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <h2 style={{ margin: 0, fontSize: '1.25rem' }}>Secrets Vault</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setShowImport(true)} style={sBtn()}>Import .env</button>
          <button onClick={handleExport} style={sBtn()}>Export</button>
          <button onClick={() => setShowCreate(!showCreate)} style={sBtn(true)}>+ New Secret</button>
        </div>
      </div>

      {/* Delete Confirmation Dialog */}
      {deleteKey && (
        <div style={{
          ...sCard, marginBottom: '1rem', borderColor: '#dc2626',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <span style={{ fontSize: '0.85rem' }}>
            Permanently delete <strong>{deleteKey}</strong>? This cannot be undone.
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setDeleteKey(null)} style={sBtn()}>Cancel</button>
            <button onClick={() => handleDelete(deleteKey)} style={sBtnDanger}>Delete</button>
          </div>
        </div>
      )}

      {/* Import Modal */}
      {showImport && (
        <div style={{ ...sCard, marginBottom: '1rem' }}>
          <div style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: 8 }}>Import from .env format</div>
          <textarea
            value={importText}
            onChange={e => setImportText(e.target.value)}
            placeholder={'KEY=value\nANOTHER_KEY=another_value\n# Comments are ignored'}
            rows={6}
            style={{ ...sInput, resize: 'vertical', fontFamily: 'monospace', fontSize: '0.8rem' }}
          />
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
            <button onClick={() => { setShowImport(false); setImportText('') }} style={sBtn()}>Cancel</button>
            <button onClick={handleImport} style={sBtn(true)}>Import</button>
          </div>
        </div>
      )}

      {/* Create Form */}
      {showCreate && (
        <div style={{ ...sCard, marginBottom: '1rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
            <input value={newKey} onChange={e => setNewKey(e.target.value)} placeholder="KEY_NAME" style={{ ...sInput, fontFamily: 'monospace' }} />
            <input value={newValue} onChange={e => setNewValue(e.target.value)} placeholder="Secret value" type="password" style={sInput} />
            <input value={newDescription} onChange={e => setNewDescription(e.target.value)} placeholder="Description (optional)" style={{ ...sInput, gridColumn: '1 / -1' }} />
            <input value={newTags} onChange={e => setNewTags(e.target.value)} placeholder="Tags (comma-separated)" style={{ ...sInput, gridColumn: '1 / -1' }} />
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button onClick={() => setShowCreate(false)} style={sBtn()}>Cancel</button>
            <button onClick={handleCreate} style={sBtn(true)}>Create Secret</button>
          </div>
        </div>
      )}

      {/* Edit Form */}
      {editKey && (
        <div style={{ ...sCard, marginBottom: '1rem', borderColor: 'var(--accent)' }}>
          <div style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: 8 }}>
            Update value for <code style={{ color: 'var(--accent)' }}>{editKey}</code>
          </div>
          <input value={editValue} onChange={e => setEditValue(e.target.value)} placeholder="New value" type="password" style={{ ...sInput, marginBottom: 10 }} />
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button onClick={() => { setEditKey(null); setEditValue('') }} style={sBtn()}>Cancel</button>
            <button onClick={handleUpdate} style={sBtn(true)}>Update</button>
          </div>
        </div>
      )}

      {/* Secrets List */}
      {secrets.length === 0 && (
        <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '3rem 0' }}>
          No secrets configured. Add your first secret above.
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {secrets.map(s => (
          <div key={s.key} style={sCard}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <code style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--text)' }}>{s.key}</code>
                  {s.tags && s.tags.map(t => (
                    <span key={t} style={{
                      fontSize: '0.6rem', padding: '1px 6px', borderRadius: 4,
                      background: 'rgba(124,58,237,0.15)', color: 'var(--accent)',
                    }}>
                      {t}
                    </span>
                  ))}
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 4, fontFamily: 'monospace' }}>
                  {revealedKey === s.key ? revealedValue : maskValue(s.key)}
                </div>
                {s.description && (
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 4 }}>
                    {s.description}
                  </div>
                )}
                <div style={{ display: 'flex', gap: 12, marginTop: 6, fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                  <span>Created: {formatDate(s.created_at)}</span>
                  {s.rotated_at && <span>Rotated: {formatDate(s.rotated_at)}</span>}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                <button onClick={() => handleReveal(s.key)} style={sBtn()}>
                  {revealedKey === s.key ? 'Hide' : 'Reveal'}
                </button>
                <button onClick={() => { setEditKey(s.key); setEditValue('') }} style={sBtn()}>Edit</button>
                <button onClick={() => handleRotate(s.key)} style={sBtn()}>Rotate</button>
                <button onClick={() => {
                  if (selectedKey === s.key) { setSelectedKey(null); setUsageLog([]) }
                  else { setSelectedKey(s.key); fetchUsage(s.key) }
                }} style={sBtn()}>
                  Usage
                </button>
                <button onClick={() => setDeleteKey(s.key)} style={{ ...sBtn(), color: '#dc2626' }}>Delete</button>
              </div>
            </div>

            {/* Usage Log (inline expand) */}
            {selectedKey === s.key && (
              <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
                <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: 8 }}>
                  Recent Usage
                </div>
                {usageLog.length === 0 ? (
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>No usage recorded.</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {usageLog.map((entry, i) => (
                      <div key={i} style={{
                        display: 'flex', justifyContent: 'space-between',
                        fontSize: '0.75rem', color: 'var(--text-muted)',
                        padding: '4px 8px', borderRadius: 4, background: 'var(--bg-deep)',
                      }}>
                        <span><strong>{entry.accessor}</strong> - {entry.action}</span>
                        <span>{formatTimestamp(entry.timestamp)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
