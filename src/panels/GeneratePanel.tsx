'use client'

import { useState, useEffect } from 'react'

interface StaffOption {
  id: string
  name: string
}

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

function GenerateCard({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(false)

  return (
    <div style={{
      background: 'var(--bg-surface)',
      border: '1px solid var(--glass-border)',
      borderRadius: 'var(--radius)',
      overflow: 'hidden',
    }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          width: '100%',
          padding: '1rem 1.25rem',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          background: 'transparent',
          textAlign: 'left',
        }}
      >
        <div>
          <div style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-primary)' }}>{title}</div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: 2 }}>{description}</div>
        </div>
        <span style={{ fontSize: '1.2rem', color: 'var(--text-muted)' }}>{open ? '-' : '+'}</span>
      </button>
      {open && (
        <div style={{ padding: '0 1.25rem 1.25rem', borderTop: '1px solid var(--glass-border)' }}>
          {children}
        </div>
      )}
    </div>
  )
}

function ResumeGenerator({ apiBase }: { apiBase: string }) {
  const [staff, setStaff] = useState<StaffOption[]>([])
  const [staffId, setStaffId] = useState('')
  const [tailoring, setTailoring] = useState('')
  const [generating, setGenerating] = useState(false)

  useEffect(() => {
    fetch(`${apiBase}/data/staff`)
      .then(r => r.json())
      .then((data: StaffOption[]) => setStaff(data))
      .catch(() => {})
  }, [apiBase])

  const generate = async () => {
    if (!staffId) return
    setGenerating(true)
    try {
      const params = new URLSearchParams({ staff_id: staffId })
      if (tailoring) params.set('tailoring', tailoring)
      const resp = await fetch(`${apiBase}/export/resume?${params}`)
      if (resp.ok) downloadBlob(resp, 'resume.docx')
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div style={{ paddingTop: '1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      <select
        value={staffId}
        onChange={e => setStaffId(e.target.value)}
        style={{
          padding: '0.6rem 0.75rem',
          background: 'var(--bg-elevated)',
          color: 'var(--text-primary)',
          border: '1px solid var(--glass-border)',
          borderRadius: 6,
          fontSize: '0.85rem',
        }}
      >
        <option value="">Select staff member...</option>
        {staff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
      <input
        value={tailoring}
        onChange={e => setTailoring(e.target.value)}
        placeholder="Tailoring notes (e.g. 'bridge inspection focus')"
        style={{
          padding: '0.6rem 0.75rem',
          background: 'var(--bg-elevated)',
          color: 'var(--text-primary)',
          border: '1px solid var(--glass-border)',
          borderRadius: 6,
          fontSize: '0.85rem',
        }}
      />
      <button
        onClick={generate}
        disabled={!staffId || generating}
        style={{
          padding: '0.6rem 1rem',
          background: 'var(--accent-primary)',
          color: 'var(--bg-deep)',
          borderRadius: 6,
          fontWeight: 600,
          fontSize: '0.85rem',
          opacity: !staffId || generating ? 0.5 : 1,
          alignSelf: 'flex-start',
        }}
      >
        {generating ? 'Generating...' : 'Generate Resume'}
      </button>
    </div>
  )
}

function SectionCGenerator({ apiBase }: { apiBase: string }) {
  const [rfp, setRfp] = useState('')
  const [generating, setGenerating] = useState(false)

  const generate = async () => {
    if (!rfp.trim()) return
    setGenerating(true)
    try {
      const resp = await fetch(`${apiBase}/export/section-c`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rfp_description: rfp }),
      })
      if (resp.ok) downloadBlob(resp, 'section_c_draft.docx')
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div style={{ paddingTop: '1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      <textarea
        value={rfp}
        onChange={e => setRfp(e.target.value)}
        placeholder="Paste RFP description or scope of work..."
        rows={4}
        style={{
          padding: '0.6rem 0.75rem',
          background: 'var(--bg-elevated)',
          color: 'var(--text-primary)',
          border: '1px solid var(--glass-border)',
          borderRadius: 6,
          fontSize: '0.85rem',
          resize: 'vertical',
        }}
      />
      <button
        onClick={generate}
        disabled={!rfp.trim() || generating}
        style={{
          padding: '0.6rem 1rem',
          background: 'var(--accent-primary)',
          color: 'var(--bg-deep)',
          borderRadius: 6,
          fontWeight: 600,
          fontSize: '0.85rem',
          opacity: !rfp.trim() || generating ? 0.5 : 1,
          alignSelf: 'flex-start',
        }}
      >
        {generating ? 'Generating...' : 'Generate Section C'}
      </button>
    </div>
  )
}

function BrochureGenerator({ apiBase }: { apiBase: string }) {
  const [topic, setTopic] = useState('')
  const [generating, setGenerating] = useState(false)

  const generate = async () => {
    if (!topic.trim()) return
    setGenerating(true)
    try {
      const resp = await fetch(`${apiBase}/export/brochure`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic }),
      })
      if (resp.ok) downloadBlob(resp, 'brochure.docx')
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div style={{ paddingTop: '1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      <input
        value={topic}
        onChange={e => setTopic(e.target.value)}
        placeholder="Topic or emphasis (e.g. 'highway design')"
        style={{
          padding: '0.6rem 0.75rem',
          background: 'var(--bg-elevated)',
          color: 'var(--text-primary)',
          border: '1px solid var(--glass-border)',
          borderRadius: 6,
          fontSize: '0.85rem',
        }}
      />
      <button
        onClick={generate}
        disabled={!topic.trim() || generating}
        style={{
          padding: '0.6rem 1rem',
          background: 'var(--accent-primary)',
          color: 'var(--bg-deep)',
          borderRadius: 6,
          fontWeight: 600,
          fontSize: '0.85rem',
          opacity: !topic.trim() || generating ? 0.5 : 1,
          alignSelf: 'flex-start',
        }}
      >
        {generating ? 'Generating...' : 'Generate Brochure'}
      </button>
    </div>
  )
}

function SpreadsheetExporter({ type, apiBase }: { type: 'staff' | 'project'; apiBase: string }) {
  const [filter, setFilter] = useState('')
  const [exporting, setExporting] = useState(false)

  const exportSheet = async () => {
    setExporting(true)
    try {
      const param = type === 'staff' ? 'specialty' : 'service'
      const url = filter
        ? `${apiBase}/export/${type}-spreadsheet?${param}=${encodeURIComponent(filter)}`
        : `${apiBase}/export/${type}-spreadsheet`
      const resp = await fetch(url)
      if (resp.ok) downloadBlob(resp, `${type}_database.xlsx`)
    } finally {
      setExporting(false)
    }
  }

  return (
    <div style={{ paddingTop: '1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      <input
        value={filter}
        onChange={e => setFilter(e.target.value)}
        placeholder={type === 'staff' ? 'Filter by specialty (optional)' : 'Filter by service (optional)'}
        style={{
          padding: '0.6rem 0.75rem',
          background: 'var(--bg-elevated)',
          color: 'var(--text-primary)',
          border: '1px solid var(--glass-border)',
          borderRadius: 6,
          fontSize: '0.85rem',
        }}
      />
      <button
        onClick={exportSheet}
        disabled={exporting}
        style={{
          padding: '0.6rem 1rem',
          background: 'var(--accent-primary)',
          color: 'var(--bg-deep)',
          borderRadius: 6,
          fontWeight: 600,
          fontSize: '0.85rem',
          opacity: exporting ? 0.5 : 1,
          alignSelf: 'flex-start',
        }}
      >
        {exporting ? 'Exporting...' : 'Export to Excel'}
      </button>
    </div>
  )
}

export interface GeneratePanelProps {
  apiBase?: string
}

export default function GeneratePanel({ apiBase = '/api' }: GeneratePanelProps) {
  return (
    <div style={{ padding: '1.5rem', maxWidth: 800 }}>
      <h2 style={{ fontSize: '1.1rem', marginBottom: '0.5rem' }}>Generate Documents</h2>
      <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '1.5rem' }}>
        Create formatted resumes, proposals, and spreadsheets from your knowledge base.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        <GenerateCard title="Resume" description="Generate a tailored resume in company format">
          <ResumeGenerator apiBase={apiBase} />
        </GenerateCard>

        <GenerateCard title="Section C" description="Draft qualification writeup from RFP description">
          <SectionCGenerator apiBase={apiBase} />
        </GenerateCard>

        <GenerateCard title="Brochure" description="Create a company brochure focused on a topic">
          <BrochureGenerator apiBase={apiBase} />
        </GenerateCard>

        <GenerateCard title="Staff Spreadsheet" description="Export staff database to Excel">
          <SpreadsheetExporter type="staff" apiBase={apiBase} />
        </GenerateCard>

        <GenerateCard title="Project Spreadsheet" description="Export project database to Excel">
          <SpreadsheetExporter type="project" apiBase={apiBase} />
        </GenerateCard>
      </div>
    </div>
  )
}
