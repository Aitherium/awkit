'use client'

import { useState, useEffect, useCallback, useRef } from 'react'

interface Contact {
  id: string
  contact_id?: string
  name: string
  email?: string
  phone?: string
  company?: string
  tags: string[]
  source?: string
  notes?: string
  created_at?: string
  updated_at?: string
  activity?: ActivityEntry[]
}

interface ActivityEntry {
  timestamp: string
  type: string
  content: string
}

interface ContactStats {
  total: number
  by_source?: Record<string, number>
  by_company?: Record<string, number>
  by_tag?: Record<string, number>
}

export interface ContactsPanelProps {
  apiBase?: string
}

const TAG_COLORS = [
  '#7c3aed', '#2563eb', '#059669', '#d97706', '#dc2626',
  '#8b5cf6', '#0891b2', '#65a30d', '#ea580c', '#e11d48',
]

function getTagColor(tag: string): string {
  let hash = 0
  for (let i = 0; i < tag.length; i++) {
    hash = tag.charCodeAt(i) + ((hash << 5) - hash)
  }
  return TAG_COLORS[Math.abs(hash) % TAG_COLORS.length]
}

function getInitials(name: string): string {
  if (!name) return '?'
  return name
    .split(' ')
    .map(w => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase()
}

function cid(c: Contact): string {
  return c.contact_id || c.id
}

export default function ContactsPanel({ apiBase = '/api/contacts' }: ContactsPanelProps) {
  const [contacts, setContacts] = useState<Contact[]>([])
  const [stats, setStats] = useState<ContactStats | null>(null)
  const [allTags, setAllTags] = useState<string[]>([])
  const [loading, setLoading] = useState(true)

  // Filters
  const [searchText, setSearchText] = useState('')
  const [filterTag, setFilterTag] = useState('')

  // Detail panel
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null)

  // Edit mode
  const [editing, setEditing] = useState(false)
  const [editForm, setEditForm] = useState<Partial<Contact>>({})

  // Create form
  const [showCreate, setShowCreate] = useState(false)
  const [newName, setNewName] = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [newPhone, setNewPhone] = useState('')
  const [newCompany, setNewCompany] = useState('')
  const [newTags, setNewTags] = useState('')
  const [newNotes, setNewNotes] = useState('')
  const [newSource, setNewSource] = useState('manual')

  // Import/Export
  const [showImport, setShowImport] = useState(false)
  const [importText, setImportText] = useState('')
  const [importStatus, setImportStatus] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Toast
  const [toast, setToast] = useState('')

  const showToast = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(''), 3000)
  }

  const fetchContacts = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (searchText) params.set('search', searchText)
      if (filterTag) params.set('tag', filterTag)
      const qs = params.toString()

      const [contactsRes, statsRes, tagsRes] = await Promise.all([
        fetch(`${apiBase}${qs ? `?${qs}` : ''}`).then(r => r.ok ? r.json() : null),
        fetch(`${apiBase}/stats`).then(r => r.ok ? r.json() : null),
        fetch(`${apiBase}/tags`).then(r => r.ok ? r.json() : null),
      ])

      // Handle multiple response shapes: {data:{contacts}}, {items}, {data:[]}
      if (contactsRes) {
        const items = contactsRes?.data?.contacts
          || contactsRes?.data?.items
          || contactsRes?.items
          || (Array.isArray(contactsRes?.data) ? contactsRes.data : null)
          || (Array.isArray(contactsRes) ? contactsRes : null)
        setContacts(items || [])
      }
      if (statsRes) {
        const s = statsRes?.data || statsRes
        setStats({
          total: s.total ?? 0,
          by_source: s.by_source,
          by_company: s.by_company,
          by_tag: s.by_tag,
        })
      }
      if (tagsRes) {
        const raw = tagsRes?.data?.tags || tagsRes?.tags || tagsRes?.data || []
        if (Array.isArray(raw)) {
          // Could be [{name, count}] or ["string"]
          setAllTags(raw.map((t: any) => typeof t === 'string' ? t : t.name))
        }
      }
    } catch (e) {
      console.error('Contacts fetch error:', e)
    }
    setLoading(false)
  }, [apiBase, searchText, filterTag])

  useEffect(() => { fetchContacts() }, [fetchContacts])

  const handleCreate = async () => {
    if (!newName) return
    try {
      const resp = await fetch(`${apiBase}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newName,
          email: newEmail || undefined,
          phone: newPhone || undefined,
          company: newCompany || undefined,
          tags: newTags ? newTags.split(',').map(s => s.trim()).filter(Boolean) : [],
          notes: newNotes || undefined,
          source: newSource,
        }),
      })
      if (resp.ok) {
        setShowCreate(false)
        setNewName(''); setNewEmail(''); setNewPhone('')
        setNewCompany(''); setNewTags(''); setNewNotes('')
        setNewSource('manual')
        showToast('Contact created')
        fetchContacts()
      }
    } catch (e) {
      console.error('Create contact error:', e)
    }
  }

  const handleUpdate = async () => {
    if (!selectedContact) return
    try {
      const resp = await fetch(`${apiBase}/${cid(selectedContact)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editForm.name || undefined,
          email: editForm.email || undefined,
          phone: editForm.phone || undefined,
          company: editForm.company || undefined,
          tags: editForm.tags,
          notes: editForm.notes,
        }),
      })
      if (resp.ok) {
        const updated = await resp.json()
        const data = updated?.data || updated
        setSelectedContact(data)
        setEditing(false)
        showToast('Contact updated')
        fetchContacts()
      }
    } catch (e) {
      console.error('Update contact error:', e)
    }
  }

  const handleDelete = async (contactId: string) => {
    if (!confirm('Delete this contact?')) return
    try {
      await fetch(`${apiBase}/${contactId}`, { method: 'DELETE' })
      if (selectedContact && cid(selectedContact) === contactId) {
        setSelectedContact(null)
      }
      showToast('Contact deleted')
      fetchContacts()
    } catch (e) {
      console.error('Delete contact error:', e)
    }
  }

  const selectContact = async (contact: Contact) => {
    const id = cid(contact)
    try {
      const res = await fetch(`${apiBase}/${id}`)
      if (res.ok) {
        const data = await res.json()
        setSelectedContact(data.data || data)
      } else {
        setSelectedContact(contact)
      }
    } catch {
      setSelectedContact(contact)
    }
    setEditing(false)
  }

  const startEditing = () => {
    if (!selectedContact) return
    setEditForm({
      name: selectedContact.name,
      email: selectedContact.email || '',
      phone: selectedContact.phone || '',
      company: selectedContact.company || '',
      tags: selectedContact.tags || [],
      notes: selectedContact.notes || '',
    })
    setEditing(true)
  }

  // Export
  const handleExport = () => {
    const csv = [
      ['Name', 'Email', 'Phone', 'Company', 'Tags', 'Notes'].join(','),
      ...contacts.map(c => [
        `"${(c.name || '').replace(/"/g, '""')}"`,
        `"${(c.email || '').replace(/"/g, '""')}"`,
        `"${(c.phone || '').replace(/"/g, '""')}"`,
        `"${(c.company || '').replace(/"/g, '""')}"`,
        `"${(c.tags || []).join('; ')}"`,
        `"${(c.notes || '').replace(/"/g, '""').replace(/\n/g, ' ')}"`,
      ].join(','))
    ].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `contacts-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
    showToast(`Exported ${contacts.length} contacts`)
  }

  // Import CSV
  const handleFileImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      setImportText(reader.result as string)
      setShowImport(true)
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  const handleImport = async () => {
    if (!importText.trim()) return
    setImportStatus('Importing...')
    try {
      // Parse CSV
      const lines = importText.trim().split('\n')
      const header = lines[0].toLowerCase()
      const hasHeader = header.includes('name') || header.includes('email')
      const dataLines = hasHeader ? lines.slice(1) : lines

      const parsed: any[] = []
      for (const line of dataLines) {
        if (!line.trim()) continue
        // Simple CSV parse (handles quoted fields)
        const fields: string[] = []
        let current = ''
        let inQuotes = false
        for (const ch of line) {
          if (ch === '"') { inQuotes = !inQuotes; continue }
          if (ch === ',' && !inQuotes) { fields.push(current.trim()); current = ''; continue }
          current += ch
        }
        fields.push(current.trim())

        const [name, email, phone, company, tags, notes] = fields
        if (!name) continue
        parsed.push({
          name,
          email: email || undefined,
          phone: phone || undefined,
          company: company || undefined,
          tags: tags ? tags.split(';').map(t => t.trim()).filter(Boolean) : [],
          notes: notes || undefined,
        })
      }

      if (parsed.length === 0) {
        setImportStatus('No valid contacts found in CSV')
        return
      }

      // Try bulk import endpoint first
      const bulkResp = await fetch(`${apiBase}/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contacts: parsed, format: 'json' }),
      })

      if (bulkResp.ok) {
        const result = await bulkResp.json()
        const count = result?.imported || result?.data?.imported || parsed.length
        setImportStatus(`Imported ${count} contacts`)
        showToast(`Imported ${count} contacts`)
      } else {
        // Fallback: create one by one
        let created = 0
        for (const c of parsed) {
          const r = await fetch(`${apiBase}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(c),
          })
          if (r.ok) created++
        }
        setImportStatus(`Imported ${created}/${parsed.length} contacts`)
        showToast(`Imported ${created} contacts`)
      }

      setShowImport(false)
      setImportText('')
      fetchContacts()
    } catch (e) {
      setImportStatus(`Import failed: ${e}`)
    }
  }

  const inputStyle: React.CSSProperties = {
    padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border, var(--glass-border, #333))',
    background: 'var(--bg-deep, #111)', color: 'var(--text, var(--text-primary, #eee))', width: '100%',
    boxSizing: 'border-box', fontSize: '0.85rem',
  }

  const btnStyle: React.CSSProperties = {
    padding: '6px 14px', borderRadius: 6, border: 'none',
    cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600,
  }

  const actionBtn: React.CSSProperties = {
    ...btnStyle,
    padding: '5px 10px', fontSize: '0.75rem', fontWeight: 500,
    background: 'var(--bg-deep, #111)', color: 'var(--text-secondary, #aaa)',
    border: '1px solid var(--border, var(--glass-border, #333))',
  }

  if (loading) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted, #888)' }}>
        Loading contacts...
      </div>
    )
  }

  return (
    <div style={{ padding: '1.5rem', maxWidth: 1100, margin: '0 auto' }}>
      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', top: 16, right: 16, zIndex: 9999,
          padding: '10px 20px', borderRadius: 8, fontSize: '0.85rem', fontWeight: 500,
          background: 'var(--accent, var(--accent-primary, #d97706))', color: '#fff',
          boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
        }}>{toast}</div>
      )}

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h2 style={{ margin: 0, fontSize: '1.25rem' }}>Contacts</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={handleExport} disabled={contacts.length === 0}
            style={{ ...btnStyle, background: 'var(--bg-elevated, #222)', color: 'var(--text-secondary, #aaa)', border: '1px solid var(--border, #333)', opacity: contacts.length ? 1 : 0.5 }}>
            Export CSV
          </button>
          <button onClick={() => fileInputRef.current?.click()}
            style={{ ...btnStyle, background: 'var(--bg-elevated, #222)', color: 'var(--text-secondary, #aaa)', border: '1px solid var(--border, #333)' }}>
            Import CSV
          </button>
          <input ref={fileInputRef} type="file" accept=".csv,.txt" style={{ display: 'none' }} onChange={handleFileImport} />
          <button
            onClick={() => setShowCreate(!showCreate)}
            style={{ ...btnStyle, background: 'var(--accent, var(--accent-primary, #d97706))', color: '#fff' }}
          >
            + New Contact
          </button>
        </div>
      </div>

      {/* Stats Bar */}
      {stats && stats.total > 0 && (
        <div style={{ display: 'flex', gap: 12, marginBottom: '1rem', flexWrap: 'wrap' }}>
          <div style={{
            padding: '8px 14px', borderRadius: 6, background: 'var(--bg-elevated, #222)',
            fontSize: '0.8rem', color: 'var(--text-muted, #888)',
          }}>
            <span style={{ fontWeight: 600, color: 'var(--text, var(--text-primary, #eee))', marginRight: 4 }}>{stats.total}</span>
            total
          </div>
          {Object.entries(stats.by_source || stats.by_company || {}).slice(0, 5).map(([key, count]) => (
            <div key={key} style={{
              padding: '8px 14px', borderRadius: 6, background: 'var(--bg-elevated, #222)',
              fontSize: '0.75rem', color: 'var(--text-muted, #888)',
            }}>
              <span style={{ fontWeight: 600, color: 'var(--text, var(--text-primary, #eee))', marginRight: 4 }}>{count}</span>
              {key}
            </div>
          ))}
        </div>
      )}

      {/* Search and Filter */}
      <div style={{ display: 'flex', gap: 8, marginBottom: '1rem' }}>
        <input
          value={searchText}
          onChange={e => setSearchText(e.target.value)}
          placeholder="Search by name, email, or company..."
          style={{ ...inputStyle, flex: 1 }}
        />
        <select
          value={filterTag}
          onChange={e => setFilterTag(e.target.value)}
          style={{
            padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border, var(--glass-border, #333))',
            background: 'var(--bg-deep, #111)', color: 'var(--text, var(--text-primary, #eee))', minWidth: 140,
          }}
        >
          <option value="">All Tags</option>
          {allTags.map(tag => (
            <option key={tag} value={tag}>{tag}</option>
          ))}
        </select>
      </div>

      {/* Create Contact Form */}
      {showCreate && (
        <div style={{
          padding: '1rem', borderRadius: 8, background: 'var(--bg-elevated, #222)',
          border: '1px solid var(--border, var(--glass-border, #333))', marginBottom: '1rem',
        }}>
          <div style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: 12 }}>New Contact</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <input value={newName} onChange={e => setNewName(e.target.value)}
              placeholder="Full name *" style={{ ...inputStyle, gridColumn: '1 / -1' }} />
            <input value={newEmail} onChange={e => setNewEmail(e.target.value)}
              placeholder="Email" style={inputStyle} />
            <input value={newPhone} onChange={e => setNewPhone(e.target.value)}
              placeholder="Phone" style={inputStyle} />
            <input value={newCompany} onChange={e => setNewCompany(e.target.value)}
              placeholder="Company" style={inputStyle} />
            <select value={newSource} onChange={e => setNewSource(e.target.value)}
              style={inputStyle}>
              <option value="manual">Manual</option>
              <option value="stripe">Stripe</option>
              <option value="email">Email</option>
              <option value="relay">Relay</option>
              <option value="booking">Booking</option>
              <option value="form_submission">Form Submission</option>
            </select>
            <input value={newTags} onChange={e => setNewTags(e.target.value)}
              placeholder="Tags (comma-separated)" style={{ ...inputStyle, gridColumn: '1 / -1' }} />
            <textarea value={newNotes} onChange={e => setNewNotes(e.target.value)}
              placeholder="Notes (optional)" rows={2}
              style={{ ...inputStyle, gridColumn: '1 / -1', resize: 'vertical' }} />
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button onClick={() => setShowCreate(false)}
              style={{ ...btnStyle, background: 'transparent', color: 'var(--text-muted, #888)', border: '1px solid var(--border, #333)' }}>
              Cancel
            </button>
            <button onClick={handleCreate} disabled={!newName}
              style={{ ...btnStyle, background: 'var(--accent, var(--accent-primary, #d97706))', color: '#fff', opacity: newName ? 1 : 0.5 }}>
              Create Contact
            </button>
          </div>
        </div>
      )}

      {/* Import Modal */}
      {showImport && (
        <div style={{
          padding: '1rem', borderRadius: 8, background: 'var(--bg-elevated, #222)',
          border: '1px solid var(--border, var(--glass-border, #333))', marginBottom: '1rem',
        }}>
          <div style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: 8 }}>Import Contacts</div>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted, #888)', marginBottom: 8 }}>
            CSV format: Name, Email, Phone, Company, Tags (semicolon-separated), Notes
          </p>
          <textarea
            value={importText}
            onChange={e => setImportText(e.target.value)}
            rows={8}
            placeholder={'Name,Email,Phone,Company,Tags,Notes\nJohn Doe,john@example.com,555-0100,Acme Inc,customer;vip,Key account'}
            style={{ ...inputStyle, resize: 'vertical', fontFamily: 'monospace', fontSize: '0.75rem' }}
          />
          {importStatus && (
            <div style={{ fontSize: '0.8rem', color: 'var(--accent, var(--accent-primary, #d97706))', marginTop: 8 }}>{importStatus}</div>
          )}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
            <button onClick={() => { setShowImport(false); setImportText(''); setImportStatus('') }}
              style={{ ...btnStyle, background: 'transparent', color: 'var(--text-muted, #888)', border: '1px solid var(--border, #333)' }}>
              Cancel
            </button>
            <button onClick={handleImport} disabled={!importText.trim()}
              style={{ ...btnStyle, background: 'var(--accent, var(--accent-primary, #d97706))', color: '#fff', opacity: importText.trim() ? 1 : 0.5 }}>
              Import
            </button>
          </div>
        </div>
      )}

      {/* Main content: list + detail */}
      <div style={{ display: 'flex', gap: 16 }}>
        {/* Contact List */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {contacts.length === 0 && (
            <div style={{ textAlign: 'center', color: 'var(--text-muted, #888)', padding: '3rem 0' }}>
              No contacts found. Add your first contact above.
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {contacts.map(contact => {
              const id = cid(contact)
              const isSelected = selectedContact && cid(selectedContact) === id
              return (
                <div
                  key={id}
                  onClick={() => selectContact(contact)}
                  style={{
                    padding: '12px 14px', borderRadius: 8, background: 'var(--bg-elevated, #222)',
                    border: isSelected
                      ? '1px solid var(--accent, var(--accent-primary, #d97706))' : '1px solid var(--border, var(--glass-border, #333))',
                    cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12,
                    transition: 'border-color 0.15s',
                  }}
                >
                  <div style={{
                    width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
                    background: 'var(--accent, var(--accent-primary, #d97706))', color: '#fff', display: 'flex',
                    alignItems: 'center', justifyContent: 'center',
                    fontSize: '0.75rem', fontWeight: 700,
                  }}>
                    {getInitials(contact.name)}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {contact.name}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted, #888)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {contact.email || ''}{contact.company ? ` — ${contact.company}` : ''}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', flexShrink: 0 }}>
                    {(contact.tags || []).slice(0, 3).map(tag => (
                      <span key={tag} style={{
                        padding: '2px 8px', borderRadius: 10, fontSize: '0.65rem', fontWeight: 600,
                        background: `${getTagColor(tag)}22`, color: getTagColor(tag),
                      }}>
                        {tag}
                      </span>
                    ))}
                    {(contact.tags || []).length > 3 && (
                      <span style={{ fontSize: '0.65rem', color: 'var(--text-muted, #888)' }}>
                        +{contact.tags.length - 3}
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Detail Side Panel */}
        {selectedContact && (
          <div style={{
            width: 360, flexShrink: 0, padding: '1rem', borderRadius: 8,
            background: 'var(--bg-elevated, #222)', border: '1px solid var(--border, var(--glass-border, #333))',
            alignSelf: 'flex-start',
          }}>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{
                  width: 40, height: 40, borderRadius: '50%',
                  background: 'var(--accent, var(--accent-primary, #d97706))', color: '#fff',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '0.85rem', fontWeight: 700,
                }}>
                  {getInitials(selectedContact.name)}
                </div>
                <div>
                  <div style={{ fontWeight: 600, fontSize: '1rem' }}>{selectedContact.name}</div>
                  {selectedContact.company && (
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted, #888)' }}>{selectedContact.company}</div>
                  )}
                </div>
              </div>
              <button onClick={() => { setSelectedContact(null); setEditing(false) }} style={{
                background: 'transparent', border: 'none', color: 'var(--text-muted, #888)',
                cursor: 'pointer', fontSize: '1rem',
              }}>x</button>
            </div>

            {/* Action buttons */}
            {!editing && (
              <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
                {selectedContact.email && (
                  <a href={`mailto:${selectedContact.email}`} style={{ textDecoration: 'none' }}>
                    <button style={actionBtn}>Send Email</button>
                  </a>
                )}
                {selectedContact.phone && (
                  <a href={`tel:${selectedContact.phone}`} style={{ textDecoration: 'none' }}>
                    <button style={actionBtn}>Call</button>
                  </a>
                )}
                <button onClick={startEditing} style={actionBtn}>Edit</button>
                <button onClick={() => handleDelete(cid(selectedContact))}
                  style={{ ...actionBtn, color: '#ef4444' }}>Delete</button>
              </div>
            )}

            {editing ? (
              /* Edit Form */
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div>
                  <label style={{ fontSize: '0.7rem', color: 'var(--text-muted, #888)', display: 'block', marginBottom: 4 }}>Name</label>
                  <input value={editForm.name || ''} onChange={e => setEditForm({ ...editForm, name: e.target.value })} style={inputStyle} />
                </div>
                <div>
                  <label style={{ fontSize: '0.7rem', color: 'var(--text-muted, #888)', display: 'block', marginBottom: 4 }}>Email</label>
                  <input value={editForm.email || ''} onChange={e => setEditForm({ ...editForm, email: e.target.value })} style={inputStyle} />
                </div>
                <div>
                  <label style={{ fontSize: '0.7rem', color: 'var(--text-muted, #888)', display: 'block', marginBottom: 4 }}>Phone</label>
                  <input value={editForm.phone || ''} onChange={e => setEditForm({ ...editForm, phone: e.target.value })} style={inputStyle} />
                </div>
                <div>
                  <label style={{ fontSize: '0.7rem', color: 'var(--text-muted, #888)', display: 'block', marginBottom: 4 }}>Company</label>
                  <input value={editForm.company || ''} onChange={e => setEditForm({ ...editForm, company: e.target.value })} style={inputStyle} />
                </div>
                <div>
                  <label style={{ fontSize: '0.7rem', color: 'var(--text-muted, #888)', display: 'block', marginBottom: 4 }}>Tags (comma-separated)</label>
                  <input value={(editForm.tags || []).join(', ')} onChange={e => setEditForm({ ...editForm, tags: e.target.value.split(',').map(t => t.trim()).filter(Boolean) })} style={inputStyle} />
                </div>
                <div>
                  <label style={{ fontSize: '0.7rem', color: 'var(--text-muted, #888)', display: 'block', marginBottom: 4 }}>Notes</label>
                  <textarea value={editForm.notes || ''} onChange={e => setEditForm({ ...editForm, notes: e.target.value })} rows={3} style={{ ...inputStyle, resize: 'vertical' }} />
                </div>
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
                  <button onClick={() => setEditing(false)} style={{ ...btnStyle, background: 'transparent', color: 'var(--text-muted, #888)', border: '1px solid var(--border, #333)' }}>Cancel</button>
                  <button onClick={handleUpdate} style={{ ...btnStyle, background: 'var(--accent, var(--accent-primary, #d97706))', color: '#fff' }}>Save</button>
                </div>
              </div>
            ) : (
              /* Detail View */
              <>
                {/* Fields */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: '0.8rem', marginBottom: 16 }}>
                  {selectedContact.email && (
                    <div><span style={{ color: 'var(--text-muted, #888)' }}>Email: </span>
                      <a href={`mailto:${selectedContact.email}`} style={{ color: 'var(--accent, var(--accent-primary, #d97706))', textDecoration: 'none' }}>{selectedContact.email}</a>
                    </div>
                  )}
                  {selectedContact.phone && (
                    <div><span style={{ color: 'var(--text-muted, #888)' }}>Phone: </span>
                      <a href={`tel:${selectedContact.phone}`} style={{ color: 'var(--text, var(--text-primary, #eee))', textDecoration: 'none' }}>{selectedContact.phone}</a>
                    </div>
                  )}
                  {selectedContact.company && (
                    <div><span style={{ color: 'var(--text-muted, #888)' }}>Company: </span>{selectedContact.company}</div>
                  )}
                  {selectedContact.source && (
                    <div><span style={{ color: 'var(--text-muted, #888)' }}>Source: </span>{selectedContact.source}</div>
                  )}
                  {selectedContact.created_at && (
                    <div><span style={{ color: 'var(--text-muted, #888)' }}>Added: </span>{new Date(selectedContact.created_at).toLocaleDateString()}</div>
                  )}
                </div>

                {/* Tags */}
                {selectedContact.tags && selectedContact.tags.length > 0 && (
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted, #888)', marginBottom: 6 }}>Tags</div>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {selectedContact.tags.map(tag => (
                        <span key={tag} style={{
                          padding: '3px 10px', borderRadius: 10, fontSize: '0.7rem', fontWeight: 600,
                          background: `${getTagColor(tag)}22`, color: getTagColor(tag),
                        }}>
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Notes */}
                {selectedContact.notes && (
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted, #888)', marginBottom: 6 }}>Notes</div>
                    <div style={{
                      padding: '8px 10px', borderRadius: 6, background: 'var(--bg-deep, #111)',
                      fontSize: '0.8rem', lineHeight: 1.5, whiteSpace: 'pre-wrap',
                    }}>
                      {selectedContact.notes}
                    </div>
                  </div>
                )}

                {/* Activity Timeline */}
                {selectedContact.activity && selectedContact.activity.length > 0 && (
                  <div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted, #888)', marginBottom: 6 }}>Activity</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {selectedContact.activity.map((entry, i) => (
                        <div key={i} style={{
                          padding: '6px 10px', borderRadius: 6, background: 'var(--bg-deep, #111)',
                          fontSize: '0.75rem', borderLeft: '3px solid var(--accent, var(--accent-primary, #d97706))',
                        }}>
                          <div style={{ color: 'var(--text-muted, #888)', fontSize: '0.65rem', marginBottom: 2 }}>
                            {new Date(entry.timestamp).toLocaleString()} — {entry.type}
                          </div>
                          <div>{entry.content}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
