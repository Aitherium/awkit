/**
 * CertTrackPanel on the surface a tenant sees: Veil's PanelApp mounts it BARE (no
 * props), so it must find its host route on its own default `/api`.
 *
 * Pins: bare render fetches `/api/certtrack/records`; a 202 build shows the building
 * note and polls; superseded renewals are history, not expired; a 403 shows the host's
 * sentence. Names are synthetic.
 */
import React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'

import CertTrackPanel, { daysUntil } from '../CertTrackPanel'

type Reply = { status: number; body: unknown }

// The Audit tab asks the host what it already holds (`GET /drop`) on its own; that call
// is answered from here so it never eats a reply a test queued for something else.
let held: unknown = { have: [], documents: 0 }

function serve(replies: Reply[]) {
  const calls: string[] = []
  ;(global as any).fetch = jest.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method || 'GET'
    calls.push(`${method} ${url}`)
    if (method === 'GET' && String(url).endsWith('/certtrack/drop')) {
      return { ok: true, status: 200, json: async () => held }
    }
    const r = replies.length > 1 ? replies.shift()! : replies[0]
    return { ok: r.status < 300, status: r.status, json: async () => r.body, blob: async () => new Blob(['x']) }
  })
  return calls
}

const iso = (days: number) => {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const cert = (id: number, name: string, expires: string | null, status: string, superseded = false) => ({
  id, name, category: 'NICET', number: '', issued: '', expires, status, superseded,
  confidence: 0.9, document: 'x.pdf', notes: '',
})

const READY = {
  state: 'ready',
  generated_at: '2026-11-11T12:00:00+00:00',
  employees: [
    { id: 1, name: 'Vale, Quentin', certs: [
      cert(1, 'NICET Level II', iso(20), 'expiring'),
      cert(2, 'NICET Level II', iso(-400), 'superseded', true),
    ] },
    { id: 2, name: 'Kestrel, Nia', certs: [cert(3, 'OSHA 30-Hour', iso(-5), 'expired')] },
  ],
  certTypes: [{ id: 'nicet', name: 'NICET Level II', category: 'NICET', primary: false }],
  summary: { records: 3, current_records: 2, employees: 2, active: 0, expiring: 1, expired: 1,
    no_expiry: 0, superseded: 1, filename_only: 0, expiring_days: 90 },
}

describe('CertTrackPanel', () => {
  it('renders bare and reads its host route', async () => {
    const calls = serve([{ status: 200, body: READY }])
    render(<CertTrackPanel />)
    expect(await screen.findByText('CertTrack')).toBeTruthy()
    await waitFor(() => expect(calls).toContain('GET /api/certtrack/records'))
    const expired = await screen.findByText('Expired', { selector: 'div' })
    expect(expired.parentElement?.textContent).toContain('1')
    expect(screen.getByText(/1 older renewals are kept as history/)).toBeTruthy()
  })

  it('shows the building note on 202 and polls until ready', async () => {
    jest.useFakeTimers()
    try {
      const calls = serve([{ status: 202, body: { state: 'building' } }, { status: 200, body: READY }])
      render(<CertTrackPanel pollMs={1000} />)
      expect(await screen.findByText(/first build takes about a minute/)).toBeTruthy()
      await act(async () => { jest.advanceTimersByTime(1100) })
      await waitFor(() => expect(calls.length).toBe(2))
      expect(await screen.findByText(/Upcoming and overdue renewals/)).toBeTruthy()
    } finally {
      jest.useRealTimers()
    }
  })

  it('alerts list excludes superseded history', async () => {
    serve([{ status: 200, body: READY }])
    render(<CertTrackPanel />)
    fireEvent.click(await screen.findByRole('button', { name: /Alerts/ }))
    const rows = await screen.findAllByText(/Vale, Quentin|Kestrel, Nia/)
    expect(rows).toHaveLength(2)
    expect(screen.queryByText(/expired 400 days ago/)).toBeNull()
  })

  it('a non-admin (403) sees only their own page, with the host sentence', async () => {
    const calls = serve([
      { status: 403, body: { detail: 'This needs a workspace administrator.' } },
      { status: 200, body: { linked: false, certs: null, uploads: [], limits: { max_bytes: 100 } } },
    ])
    render(<CertTrackPanel />)
    expect((await screen.findByTestId('certtrack-employee-note')).textContent)
      .toContain('workspace administrator')
    expect(await screen.findByText('Upload a certificate')).toBeTruthy()
    await waitFor(() => expect(calls).toContain('GET /api/certtrack/me'))
    expect(screen.queryByRole('button', { name: 'Review' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Audit' })).toBeNull()
  })

  it('review confirms an entry through the host route', async () => {
    const entry = { id: 'e1', person: 'Vale, Quentin', status: 'extracted', state: 'active',
      origin: 'extraction', cert_name: 'OSHA 30-Hour', category: 'OSHA', number: 'A1',
      issued: '', expires: '2030-01-01', source_filename: 'x.pdf', confidence: 0.6,
      filename_only: true, confirmed_by: '', confirmed_at: '', dispute_reason: '' }
    const queue = { counts: { uploads: 0, disputed: 0, extracted: 1 }, uploads: [], items: [entry] }
    const calls = serve([
      { status: 200, body: READY }, { status: 200, body: queue },
      { status: 200, body: { ...entry, status: 'curated' } },
      { status: 200, body: { ...queue, items: [], counts: { uploads: 0, disputed: 0, extracted: 0 } } },
    ])
    render(<CertTrackPanel />)
    fireEvent.click(await screen.findByRole('button', { name: 'Review' }))
    expect(await screen.findByText('(file name only)', { exact: false })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(calls).toContain('POST /api/certtrack/entries/e1/confirm'))
  })

  it('audit filters records by a cross-check', async () => {
    const rec = (id: string, number: string) => ({ id, person: 'P', status: 'extracted', state: 'active',
      origin: 'extraction', cert_name: `C${id}`, category: 'NICET', number, issued: '', expires: '',
      source_filename: 'x.pdf', confidence: 0.9, filename_only: false, confirmed_by: '',
      confirmed_at: '', dispute_reason: '', evidence: [{ field: 'number', value: number, where: 'text', excerpt: 'No 12' }],
      checks: { number: number.length < 5 ? 'bad_format' : 'ok' } })
    const audit = { counts: { entries: 2, curated: 0, extracted: 2, disputed: 0, spreadsheet_rows: 0,
      number_bad_format: 1, number_ok: 1 }, records: [rec('1', '12'), rec('2', '123456')], spreadsheet_only: [] }
    serve([{ status: 200, body: READY }, { status: 200, body: audit }])
    render(<CertTrackPanel />)
    fireEvent.click(await screen.findByRole('button', { name: 'Audit' }))
    fireEvent.click(await screen.findByText('More'))
    expect(await screen.findByText('C1')).toBeTruthy()
    expect(screen.queryByText('C2')).toBeNull()
    expect(screen.getByText(/in the document: …No 12…/)).toBeTruthy()
  })

  it('audit tab: first load shows exactly two controls, the drop box and Download audit', async () => {
    held = { have: [{ kind: 'roster', text: 'Employee list: 155 people' }], documents: 739 }
    try {
      const calls = serve([{ status: 200, body: READY }])
      render(<CertTrackPanel />)
      fireEvent.click(await screen.findByRole('button', { name: 'Audit' }))
      const tab = await screen.findByTestId('certtrack-audit')
      expect(await screen.findByText('Employee list: 155 people')).toBeTruthy()
      const controls = Array.from(tab.querySelectorAll('button, input, select, textarea'))
      expect(controls.map((c) => c.getAttribute('aria-label') || c.textContent)).toEqual(
        ['Drop your files here', 'Download audit'])
      expect(tab.textContent).toContain(
        'Drop your files here (employee list, certifications, licenses). Any names, CSV or Excel.')
      expect((screen.getByLabelText('Drop your files here') as HTMLInputElement).multiple).toBe(true)
      for (const gone of ['Upload corrected sheet', 'First audit', 'Compare with the documents', 'Download audit CSV',
        'Your spreadsheet', 'Import these', 'Use as the employee list', 'Cross-checks']) {
        expect(tab.textContent).not.toContain(gone)
      }
      expect(calls.filter((c) => c.includes('/certtrack/audit') || c.includes('/sources'))).toEqual([])
    } finally {
      held = { have: [], documents: 0 }
    }
  })

  it('audit tab: three files dropped together are named in one sentence each, then one audit', async () => {
    ;(global as any).URL.createObjectURL = jest.fn(() => 'blob:x')
    ;(global as any).URL.revokeObjectURL = jest.fn()
    const reply = { have: [], documents: 739, files: [
      { file: 'a.xlsx', kind: 'roster', text: 'Employee list: 155 people' },
      { file: 'b.xlsx', kind: 'certifications', text: 'Certifications: 212 rows' },
      { file: 'c.csv', kind: 'licenses', text: 'Licenses: 48 rows' }] }
    const calls = serve([{ status: 200, body: READY }, { status: 200, body: reply },
      { status: 200, body: { ...reply, files: [{ file: 'b.xlsx', kind: 'licenses', text: 'Licenses: 212 rows' }] } },
      { status: 200, body: {} }])
    render(<CertTrackPanel />)
    fireEvent.click(await screen.findByRole('button', { name: 'Audit' }))
    const three = ['a.xlsx', 'b.xlsx', 'c.csv'].map((n) => new File(['x'], n))
    fireEvent.change(await screen.findByLabelText('Drop your files here'), { target: { files: three } })
    expect(await screen.findByText(/Employee list: 155 people/)).toBeTruthy()
    expect(screen.getByText(/Certifications: 212 rows/)).toBeTruthy()
    expect(screen.getByText(/Licenses: 48 rows/)).toBeTruthy()
    const post = ((global as any).fetch as jest.Mock).mock.calls.find((c) => c[1]?.method === 'POST')
    expect(post[0]).toBe('/api/certtrack/drop')
    expect((post[1].body as FormData).getAll('files').map((f) => (f as File).name)).toEqual(['a.xlsx', 'b.xlsx', 'c.csv'])
    expect(screen.queryByRole('button', { name: 'Yes' })).toBeNull()  // nothing needed asking
    // "not right?" on one file re-files only that file
    fireEvent.click(screen.getAllByText('not right?')[1])
    fireEvent.change(screen.getByLabelText('What is b.xlsx'), { target: { value: 'licenses' } })
    expect(await screen.findByText(/Licenses: 212 rows/)).toBeTruthy()
    const again = ((global as any).fetch as jest.Mock).mock.calls.filter((c) => c[1]?.method === 'POST')[1][1].body as FormData
    expect(again.getAll('files')).toHaveLength(1)
    expect(JSON.parse(again.get('kinds') as string)).toEqual({ 'b.xlsx': 'licenses' })
    fireEvent.click(screen.getByRole('button', { name: 'Download audit' }))
    await waitFor(() => expect(calls).toContain('GET /api/certtrack/audit-sheet.xlsx'))
  })

  it('audit tab: a re-dropped audit sheet asks one confirm before it becomes the reference', async () => {
    const ask = { file: 'audit.xlsx', kind: 'export', text: 'Audit sheet (nothing changed yet)',
      ask: { type: 'confirm', digest: 'dg', question: 'Make this the reference? 12 changed, 3 added, 1 removed.' } }
    serve([{ status: 200, body: READY }, { status: 200, body: { have: [], documents: 739, files: [ask] } },
      { status: 200, body: { have: [], documents: 739, files: [
        { file: 'audit.xlsx', kind: 'export', text: 'Audit sheet: it is now the reference (12 changed, 3 added, 1 removed).' }] } }])
    render(<CertTrackPanel />)
    fireEvent.click(await screen.findByRole('button', { name: 'Audit' }))
    fireEvent.change(await screen.findByLabelText('Drop your files here'), { target: { files: [new File(['x'], 'audit.xlsx')] } })
    expect(await screen.findByText(/Make this the reference\? 12 changed, 3 added, 1 removed\./)).toBeTruthy()
    const posts = () => ((global as any).fetch as jest.Mock).mock.calls.filter((c) => c[1]?.method === 'POST')
    expect(posts()).toHaveLength(1)
    expect((posts()[0][1].body as FormData).get('confirm')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Yes' }))
    expect(await screen.findByText(/it is now the reference/)).toBeTruthy()
    expect(JSON.parse((posts()[1][1].body as FormData).get('confirm') as string)).toEqual({ 'audit.xlsx': 'dg' })
    expect(screen.queryByRole('button', { name: 'Yes' })).toBeNull()
  })

  it('a missing host route is one plain sentence and one button, never "HTTP 404"', async () => {
    // The owner's desktop (2026-11-16) has no CertTrack backend: the route answers 404 with
    // a non-JSON body, so `detail` is empty and the panel used to print "HTTP 404".
    const calls = serve([{ status: 404, body: undefined }])
    ;(global as any).fetch = jest.fn(async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method || 'GET'} ${url}`)
      return { ok: false, status: 404, json: async () => { throw new Error('not json') } }
    })
    render(<CertTrackPanel />)
    const alert = await screen.findByTestId('certtrack-unavailable')
    expect(alert.textContent).toContain('CertTrack is not connected on this desktop yet')
    expect(alert.textContent).not.toMatch(/HTTP|404/)
    expect(screen.queryByRole('button', { name: 'Employees' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(calls.filter((c) => c === 'GET /api/certtrack/records').length).toBeGreaterThan(1))
  })

  it('a dropped connection says so in words', async () => {
    ;(global as any).fetch = jest.fn(async () => { throw new TypeError('Failed to fetch') })
    render(<CertTrackPanel />)
    const alert = await screen.findByTestId('certtrack-unavailable')
    expect(alert.textContent).toMatch(/Could not load your certifications\. Check your connection/)
    expect(alert.textContent).not.toMatch(/Failed to fetch/)
  })

  it('daysUntil counts whole days', () => {
    expect(daysUntil(null)).toBeNull()
    expect(daysUntil(iso(3))).toBe(3)
  })
})
