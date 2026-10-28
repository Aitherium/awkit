'use client'

import { useEffect, useRef, useState } from 'react'

interface Staff {
  id: string
  name: string
  location: string | null
  school: string | null
  degree: string | null
  years_experience: number | null
  certifications: string[]
  specialties: string[]
}

interface Project {
  id: string
  name: string
  client: string | null
  location: string | null
  value: string | null
  year_completed: string | null
  services: string[]
  key_staff: string[]
}

type SubTab = 'staff' | 'projects'

function downloadBlob(resp: Response, fallbackName: string) {
  const disposition = resp.headers.get('Content-Disposition') || ''
  const match = disposition.match(/filename=(.+)/)
  const filename = match ? match[1] : fallbackName
  resp.blob().then(blob => {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  })
}

export interface DatabasePanelProps {
  apiBase?: string
  exportBase?: string
}

export default function DatabasePanel({ apiBase = '/api/data', exportBase = '/api/export' }: DatabasePanelProps) {
  const [subTab, setSubTab] = useState<SubTab>('staff')
  const [staff, setStaff] = useState<Staff[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [search, setSearch] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [importNote, setImportNote] = useState('')
  const importRef = useRef<HTMLInputElement>(null)

  // BOTH lists load on mount and on every search: each tab's label shows its count,
  // and fetching only the selected tab left the other reading "Projects (0)" until it
  // was clicked, when it jumped to 33 (customer review, 2026-10-27).
  useEffect(() => {
    let cancelled = false
    const params = search ? `?search=${encodeURIComponent(search)}` : ''
    const load = <T,>(path: string, set: (rows: T[]) => void) =>
      fetch(`${apiBase}/${path}${params}`)
        .then(r => (r.ok ? r.json() : []))
        .then(rows => { if (!cancelled && Array.isArray(rows)) set(rows as T[]) })
        .catch(() => {})
    load<Staff>('staff', setStaff)
    load<Project>('projects', setProjects)
    return () => { cancelled = true }
  }, [search, apiBase, reloadKey])

  // A project list (CSV/XLSX) becomes project records: "upload a list of all
  // projects (current & past)" -- customer review, 2026-10-27. Re-importing updates by name.
  const importProjects = async (file: File) => {
    setImportNote(`Importing ${file.name}...`)
    try {
      const form = new FormData()
      form.append('file', file)
      const r = await fetch(`${apiBase}/projects/import`, { method: 'POST', body: form })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) {
        setImportNote(typeof d?.detail === 'string' ? d.detail : 'That list could not be imported.')
        return
      }
      const skipped = Array.isArray(d.skipped_rows) && d.skipped_rows.length
        ? `, ${d.skipped_rows.length} rows without a project name skipped` : ''
      setImportNote(`Imported ${file.name}: ${d.created ?? 0} added, ${d.updated ?? 0} updated${skipped}.`)
      setSubTab('projects')
      setReloadKey(k => k + 1)
    } catch {
      setImportNote('That list could not be imported: the workspace did not answer.')
    }
  }

  const exportExcel = async () => {
    const url = subTab === 'staff' ? `${exportBase}/staff-spreadsheet` : `${exportBase}/project-spreadsheet`
    const resp = await fetch(url)
    if (resp.ok) downloadBlob(resp, `${subTab}_database.xlsx`)
  }

  return (
    <div style={{ padding: '1.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h2 style={{ fontSize: '1.1rem' }}>Database</h2>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
        <button
          onClick={() => importRef.current?.click()}
          title="Import a project list from a CSV or Excel file (needs a Project or Name column)"
          style={{
            padding: '0.5rem 1rem',
            background: 'var(--bg-surface)',
            color: 'var(--text-secondary)',
            border: '1px solid var(--border, #333)',
            borderRadius: 'var(--radius)',
            fontWeight: 600,
            fontSize: '0.8rem',
          }}
        >
          Import project list
        </button>
        <input
          ref={importRef}
          type="file"
          hidden
          aria-label="Project list file"
          accept=".csv,.xlsx,.xlsm"
          onChange={e => { const f = e.target.files?.[0]; if (f) importProjects(f); e.target.value = '' }}
        />
        <button
          onClick={exportExcel}
          style={{
            padding: '0.5rem 1rem',
            background: 'var(--accent-primary)',
            color: 'var(--bg-deep)',
            borderRadius: 'var(--radius)',
            fontWeight: 600,
            fontSize: '0.8rem',
          }}
        >
          Export to Excel
        </button>
        </div>
      </div>
      {importNote && (
        <div role="status" style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '0.75rem' }}>
          {importNote}
        </div>
      )}

      {/* Sub-tabs */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
        {(['staff', 'projects'] as SubTab[]).map(t => (
          <button
            key={t}
            onClick={() => { setSubTab(t); setExpandedId(null) }}
            style={{
              padding: '0.4rem 1rem',
              background: subTab === t ? 'var(--accent-primary)' : 'var(--bg-surface)',
              color: subTab === t ? 'var(--bg-deep)' : 'var(--text-secondary)',
              borderRadius: 6,
              fontSize: '0.8rem',
              fontWeight: 600,
            }}
          >
            {t === 'staff' ? `Staff (${staff.length})` : `Projects (${projects.length})`}
          </button>
        ))}
      </div>

      {/* Search */}
      <input
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder={`Search ${subTab}...`}
        style={{
          width: '100%',
          padding: '0.6rem 0.75rem',
          background: 'var(--bg-surface)',
          border: '1px solid var(--glass-border)',
          borderRadius: 6,
          color: 'var(--text-primary)',
          fontSize: '0.85rem',
          marginBottom: '1rem',
        }}
      />

      {/* Staff Table */}
      {subTab === 'staff' && (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--glass-border)', textAlign: 'left' }}>
              <th style={thStyle}>Name</th>
              <th style={thStyle}>Location</th>
              <th style={thStyle}>Degree</th>
              <th style={thStyle}>Years</th>
              <th style={thStyle}>Specialties</th>
            </tr>
          </thead>
          <tbody>
            {staff.map(s => (
              <>
                <tr
                  key={s.id}
                  onClick={() => setExpandedId(expandedId === s.id ? null : s.id)}
                  style={{ borderBottom: '1px solid var(--glass-border)', cursor: 'pointer' }}
                >
                  <td style={tdStyle}>{s.name}</td>
                  <td style={tdStyle}>{s.location || '-'}</td>
                  <td style={tdStyle}>{s.degree || '-'}</td>
                  <td style={tdStyle}>{s.years_experience ?? '-'}</td>
                  <td style={tdStyle}>
                    {(s.specialties || []).slice(0, 3).join(', ')}
                    {s.specialties.length > 3 && '...'}
                  </td>
                </tr>
                {expandedId === s.id && (
                  <tr key={`${s.id}-detail`}>
                    <td colSpan={5} style={{ padding: '0.75rem', background: 'var(--bg-elevated)', fontSize: '0.8rem' }}>
                      <div><strong>School:</strong> {s.school || '-'}</div>
                      <div><strong>Certifications:</strong> {(s.certifications || []).join(', ') || '-'}</div>
                      <div><strong>All Specialties:</strong> {(s.specialties || []).join(', ') || '-'}</div>
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
      )}

      {/* Projects Table */}
      {subTab === 'projects' && (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--glass-border)', textAlign: 'left' }}>
              <th style={thStyle}>Project</th>
              <th style={thStyle}>Client</th>
              <th style={thStyle}>Location</th>
              <th style={thStyle}>Value</th>
              <th style={thStyle}>Year</th>
              <th style={thStyle}>Services</th>
            </tr>
          </thead>
          <tbody>
            {projects.map(p => (
              <>
                <tr
                  key={p.id}
                  onClick={() => setExpandedId(expandedId === p.id ? null : p.id)}
                  style={{ borderBottom: '1px solid var(--glass-border)', cursor: 'pointer' }}
                >
                  <td style={tdStyle}>{p.name}</td>
                  <td style={tdStyle}>{p.client || '-'}</td>
                  <td style={tdStyle}>{p.location || '-'}</td>
                  <td style={tdStyle}>{p.value || '-'}</td>
                  <td style={tdStyle}>{p.year_completed || '-'}</td>
                  <td style={tdStyle}>
                    {(p.services || []).slice(0, 2).join(', ')}
                    {p.services.length > 2 && '...'}
                  </td>
                </tr>
                {expandedId === p.id && (
                  <tr key={`${p.id}-detail`}>
                    <td colSpan={6} style={{ padding: '0.75rem', background: 'var(--bg-elevated)', fontSize: '0.8rem' }}>
                      <div><strong>All Services:</strong> {(p.services || []).join(', ') || '-'}</div>
                      <div><strong>Key Staff:</strong> {(p.key_staff || []).join(', ') || '-'}</div>
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
      )}

      {((subTab === 'staff' && staff.length === 0) || (subTab === 'projects' && projects.length === 0)) && (
        <p style={{ textAlign: 'center', color: 'var(--text-muted)', marginTop: '2rem', fontSize: '0.85rem' }}>
          No {subTab} records found. Upload documents to populate the database.
        </p>
      )}
    </div>
  )
}

const thStyle: React.CSSProperties = { padding: '0.5rem', fontSize: '0.75rem', color: 'var(--text-muted)' }
const tdStyle: React.CSSProperties = { padding: '0.5rem', fontSize: '0.8rem' }
