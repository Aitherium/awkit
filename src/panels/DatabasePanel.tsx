'use client'

import { useEffect, useState } from 'react'

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

  useEffect(() => {
    const params = search ? `?search=${encodeURIComponent(search)}` : ''
    if (subTab === 'staff') {
      fetch(`${apiBase}/staff${params}`)
        .then(r => r.json())
        .then(setStaff)
        .catch(() => {})
    } else {
      fetch(`${apiBase}/projects${params}`)
        .then(r => r.json())
        .then(setProjects)
        .catch(() => {})
    }
  }, [subTab, search, apiBase])

  const exportExcel = async () => {
    const url = subTab === 'staff' ? `${exportBase}/staff-spreadsheet` : `${exportBase}/project-spreadsheet`
    const resp = await fetch(url)
    if (resp.ok) downloadBlob(resp, `${subTab}_database.xlsx`)
  }

  return (
    <div style={{ padding: '1.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h2 style={{ fontSize: '1.1rem' }}>Database</h2>
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
