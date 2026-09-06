'use client'

/**
 * TaxDeskPanel — Personal Tax Preparation & CPA Package
 *
 * Six tabs: Documents, Ledger, Review, Bills, Worksheets, Package.
 *
 * Every tab used to render a sentence of placeholder prose ("Deduplicated
 * transaction ledger appears here") over a backend that could already answer
 * all of it. The panel now calls the Genesis /taxdesk router for real.
 *
 * Endpoint names are load-bearing and were, at one point, three mutually
 * inconsistent guesses (panel `/api/taxdesk/*`, Genesis `/taxdesk/*`, manifest
 * `/api/tax/*`). They are asserted against the router by
 * `dev/tools/check_app_manifest_routes.py` — do not rename one side only.
 *
 * States are kept DISTINCT on purpose: "loading", "this call failed", and
 * "there is genuinely nothing here" must never render identically, because a
 * silent empty is how a broken read plane passes for an empty ledger.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react'
import { FileUp, AlertCircle, CheckCircle2, RefreshCw } from 'lucide-react'

type TabMode = 'documents' | 'ledger' | 'review' | 'bills' | 'worksheets' | 'package'

interface EntitlementState {
  entitled: boolean
  checking: boolean
  error?: string
}

interface TaxDeskStats {
  documents_uploaded: number
  transactions_processed: number
  categories_applied: number
  total_ingest_size_mb: number
  pending_review?: number
}

interface TaxDeskPanelProps {
  apiBase?: string
}

/** Per-tab async state. `error` and `data === null` are different things. */
interface TabState<T> {
  data: T | null
  loading: boolean
  error: string
}

const ACCENT = '#10b981'
const WARNING = '#f59e0b'
const ERROR = '#ef4444'

const FILING_STATUSES = [
  { value: 'single', label: 'Single' },
  { value: 'mfj', label: 'Married filing jointly' },
  { value: 'mfs', label: 'Married filing separately' },
  { value: 'hoh', label: 'Head of household' },
  { value: 'qw', label: 'Qualifying widow(er)' },
]

const money = (n: unknown): string => {
  const v = typeof n === 'number' ? n : Number(n ?? 0)
  if (!Number.isFinite(v)) return '—'
  return v.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

export default function TaxDeskPanel({ apiBase = '/api/taxdesk' }: TaxDeskPanelProps) {
  const [tab, setTab] = useState<TabMode>('documents')
  const [entitlement, setEntitlement] = useState<EntitlementState>({ entitled: false, checking: true })
  const [error, setError] = useState<string>('')
  const [dragActive, setDragActive] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadNote, setUploadNote] = useState('')
  const [stats, setStats] = useState<TaxDeskStats>({
    documents_uploaded: 0,
    transactions_processed: 0,
    categories_applied: 0,
    total_ingest_size_mb: 0,
  })

  // Filing profile drives the worksheet + package math. Defaulting this
  // silently is how a married filer gets a single-filer return.
  const [filingStatus, setFilingStatus] = useState('single')
  const [taxYear, setTaxYear] = useState(2025)
  const [stateRate, setStateRate] = useState('0')

  const [documents, setDocuments] = useState<TabState<any>>({ data: null, loading: false, error: '' })
  const [ledger, setLedger] = useState<TabState<any>>({ data: null, loading: false, error: '' })
  const [review, setReview] = useState<TabState<any>>({ data: null, loading: false, error: '' })
  const [bills, setBills] = useState<TabState<any>>({ data: null, loading: false, error: '' })
  const [worksheet, setWorksheet] = useState<TabState<any>>({ data: null, loading: false, error: '' })
  const [pkg, setPkg] = useState<TabState<any>>({ data: null, loading: false, error: '' })

  const dragRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  /**
   * One request helper so every tab reports failure the same way.
   * A non-2xx is thrown with the server's own message when it has one —
   * "HTTP 500" alone sends people to the browser console for something the
   * API already explained.
   */
  const api = useCallback(
    async (path: string, init?: RequestInit): Promise<any> => {
      const res = await fetch(`${apiBase}${path}`, { ...init, cache: 'no-store' })
      const text = await res.text()
      let body: any = null
      try {
        body = text ? JSON.parse(text) : null
      } catch {
        body = { error: text.slice(0, 300) }
      }
      if (!res.ok) {
        const detail = body?.detail ?? body
        const msg =
          (typeof detail === 'object' && (detail?.message || detail?.error)) ||
          (typeof detail === 'string' ? detail : '') ||
          `HTTP ${res.status}`
        throw new Error(msg)
      }
      return body
    },
    [apiBase],
  )

  const loadStats = useCallback(async () => {
    try {
      setStats(await api('/stats'))
    } catch (e) {
      setError(`Could not load stats: ${e instanceof Error ? e.message : String(e)}`)
    }
  }, [api])

  // Entitlement on mount.
  useEffect(() => {
    let cancelled = false
    const check = async () => {
      setEntitlement({ entitled: false, checking: true })
      try {
        const res = await fetch(`${apiBase}/check-entitlement`, { cache: 'no-store' })
        // 402/403 is a genuine "not entitled", not a backend fault — it must
        // render the upgrade path, never the error state.
        if (res.status === 402 || res.status === 403) {
          if (!cancelled) setEntitlement({ entitled: false, checking: false })
          return
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()
        if (!cancelled) setEntitlement({ entitled: !!data.entitled, checking: false })
      } catch (e) {
        if (!cancelled) {
          setEntitlement({
            entitled: false,
            checking: false,
            error: e instanceof Error ? e.message : String(e),
          })
        }
      }
    }
    check()
    return () => {
      cancelled = true
    }
  }, [apiBase])

  useEffect(() => {
    if (entitlement.entitled && !entitlement.checking) loadStats()
  }, [entitlement.entitled, entitlement.checking, loadStats])

  /** Generic tab loader — keeps loading/error/empty distinct for every tab. */
  const loadInto = useCallback(
    async (
      setter: React.Dispatch<React.SetStateAction<TabState<any>>>,
      path: string,
      init?: RequestInit,
    ) => {
      setter({ data: null, loading: true, error: '' })
      try {
        setter({ data: await api(path, init), loading: false, error: '' })
      } catch (e) {
        setter({ data: null, loading: false, error: e instanceof Error ? e.message : String(e) })
      }
    },
    [api],
  )

  const worksheetQuery = useCallback(() => {
    const rate = Number(stateRate) || 0
    return `?filing_status=${encodeURIComponent(filingStatus)}&tax_year=${taxYear}&state_flat_rate=${rate}`
  }, [filingStatus, taxYear, stateRate])

  // Load whatever the active tab needs. Worksheets/Package are NOT auto-run:
  // both are expensive and the package writes files, so they are explicit.
  useEffect(() => {
    if (!entitlement.entitled) return
    if (tab === 'documents') loadInto(setDocuments, '/list-documents?status=all')
    if (tab === 'ledger') loadInto(setLedger, '/ledger-summary?year=0')
    if (tab === 'review') loadInto(setReview, '/review-queue?limit=50')
    if (tab === 'bills') loadInto(setBills, '/bills-overview', { method: 'POST' })
  }, [tab, entitlement.entitled, loadInto])

  const ingestFiles = async (files: FileList | null) => {
    if (!files || !files.length) return
    if (!entitlement.entitled) {
      setError('Upload requires TaxDesk entitlement')
      return
    }
    const form = new FormData()
    Array.from(files).forEach(f => form.append('files', f))

    setUploading(true)
    setUploadNote('')
    try {
      const result = await api('/ingest-batch', { method: 'POST', body: form })
      const ok = result?.ingested ?? 0
      const bad = result?.failed ?? 0
      setUploadNote(
        bad > 0
          ? `Ingested ${ok}, ${bad} failed — see Documents for which.`
          : `Ingested ${ok} document${ok === 1 ? '' : 's'}.`,
      )
      await loadStats()
      if (tab === 'documents') loadInto(setDocuments, '/list-documents?status=all')
    } catch (e) {
      setError(`Upload failed: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setUploading(false)
    }
  }

  const handleDrag = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.type === 'dragenter' || e.type === 'dragover') setDragActive(true)
    else if (e.type === 'dragleave') setDragActive(false)
  }

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(false)
    await ingestFiles(e.dataTransfer.files)
  }

  // ─────────────────────────────────────────────────────────────────────
  // NOT ENTITLED — purchase path
  // ─────────────────────────────────────────────────────────────────────
  if (!entitlement.checking && !entitlement.entitled && !entitlement.error) {
    return (
      <div style={{ padding: '3rem 2rem', textAlign: 'center', maxWidth: 600, margin: '0 auto' }}>
        <AlertCircle size={48} color={WARNING} style={{ margin: '0 auto 16px' }} />
        <h2 style={{ margin: '0 0 8px 0', fontSize: 24, fontWeight: 600 }}>
          TaxDesk requires a paid plan
        </h2>
        <p style={{ margin: '0 0 24px 0', color: '#9ca3af', fontSize: 14 }}>
          TaxDesk is a professional-grade tax prep tool for personal 1040 returns and
          Schedule C self-employment income. It requires the <strong>Pro</strong> plan or higher.
        </p>
        <a
          href="/portal/marketplace/toolpack.taxdesk"
          style={{
            display: 'inline-block',
            padding: '10px 24px',
            borderRadius: 6,
            background: ACCENT,
            color: '#fff',
            textDecoration: 'none',
            fontWeight: 600,
            fontSize: 14,
          }}
        >
          Upgrade to Pro — $199/month
        </a>
      </div>
    )
  }

  // ─────────────────────────────────────────────────────────────────────
  // BACKEND ERROR
  // ─────────────────────────────────────────────────────────────────────
  if (entitlement.error) {
    return (
      <div style={{ padding: '3rem 2rem', textAlign: 'center', maxWidth: 600, margin: '0 auto' }}>
        <AlertCircle size={48} color={ERROR} style={{ margin: '0 auto 16px' }} />
        <h2 style={{ margin: '0 0 8px 0', fontSize: 24, fontWeight: 600 }}>Backend unavailable</h2>
        <p style={{ margin: '0 0 24px 0', color: '#9ca3af', fontSize: 14 }}>{entitlement.error}</p>
        <button
          onClick={() => window.location.reload()}
          style={{
            padding: '8px 20px',
            borderRadius: 6,
            background: ACCENT,
            color: '#fff',
            border: 'none',
            cursor: 'pointer',
            fontWeight: 600,
            fontSize: 14,
          }}
        >
          Try again
        </button>
      </div>
    )
  }

  if (entitlement.checking) {
    return (
      <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>
        Checking entitlement…
      </div>
    )
  }

  // ─────────────────────────────────────────────────────────────────────
  // ENTITLED — full UI
  // ─────────────────────────────────────────────────────────────────────
  const tabStyle = (active: boolean): React.CSSProperties => ({
    padding: '8px 16px',
    borderRadius: 6,
    border: '1px solid var(--border)',
    background: active ? 'var(--accent)' : 'transparent',
    color: active ? '#fff' : 'var(--text-muted)',
    cursor: 'pointer',
    fontSize: '0.875rem',
    fontWeight: active ? 600 : 500,
    transition: 'all 200ms',
  })

  const statCard: React.CSSProperties = {
    padding: '14px 16px',
    borderRadius: 8,
    background: 'var(--bg-elevated)',
    border: '1px solid var(--border)',
  }

  const ingestZone: React.CSSProperties = {
    padding: '2rem',
    borderRadius: 8,
    border: `2px dashed ${dragActive ? ACCENT : 'var(--border)'}`,
    background: dragActive ? 'rgba(16, 185, 129, 0.05)' : 'var(--bg-deep)',
    textAlign: 'center',
    cursor: 'pointer',
    transition: 'all 200ms',
    marginBottom: '1.5rem',
  }

  const panelBox: React.CSSProperties = {
    padding: '1.25rem',
    borderRadius: 8,
    background: 'var(--bg-elevated)',
    border: '1px solid var(--border)',
  }

  const btn: React.CSSProperties = {
    padding: '8px 16px',
    borderRadius: 6,
    background: ACCENT,
    color: '#fff',
    border: 'none',
    cursor: 'pointer',
    fontWeight: 600,
    fontSize: '0.875rem',
  }

  const th: React.CSSProperties = {
    textAlign: 'left',
    padding: '8px 10px',
    fontSize: '0.75rem',
    color: 'var(--text-muted)',
    borderBottom: '1px solid var(--border)',
    whiteSpace: 'nowrap',
  }
  const td: React.CSSProperties = {
    padding: '8px 10px',
    fontSize: '0.875rem',
    borderBottom: '1px solid var(--border)',
  }

  /** Loading / error / empty, never collapsed into one another. */
  const asyncBody = (
    state: TabState<any>,
    emptyMessage: string,
    render: (data: any) => React.ReactNode,
  ): React.ReactNode => {
    if (state.loading) {
      return <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>Loading…</div>
    }
    if (state.error) {
      return (
        <div style={{ padding: '1rem', color: ERROR, fontSize: '0.875rem' }}>
          <strong>This request failed.</strong> {state.error}
        </div>
      )
    }
    if (!state.data) {
      return <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>{emptyMessage}</div>
    }
    return render(state.data)
  }

  const scrollX: React.CSSProperties = { overflowX: 'auto' }

  return (
    <div style={{ padding: '1.5rem', maxWidth: 1200, margin: '0 auto' }}>
      <div style={{ marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: '1rem' }}>
          <h1 style={{ margin: 0, fontSize: 28, fontWeight: 700 }}>TaxDesk</h1>
          <button onClick={loadStats} style={{ ...btn, background: 'transparent', color: 'var(--text-muted)', border: '1px solid var(--border)' }}>
            <RefreshCw size={14} style={{ verticalAlign: 'middle' }} /> Refresh
          </button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
          <div style={statCard}>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 4 }}>Documents</div>
            <div style={{ fontSize: '1.5rem', fontWeight: 700, color: ACCENT }}>{stats.documents_uploaded}</div>
          </div>
          <div style={statCard}>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 4 }}>Transactions</div>
            <div style={{ fontSize: '1.5rem', fontWeight: 700 }}>{stats.transactions_processed}</div>
          </div>
          <div style={statCard}>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 4 }}>Categorized</div>
            <div style={{ fontSize: '1.5rem', fontWeight: 700 }}>{stats.categories_applied}</div>
          </div>
          <div style={statCard}>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 4 }}>Ingest Size</div>
            <div style={{ fontSize: '1.5rem', fontWeight: 700 }}>
              {Number(stats.total_ingest_size_mb ?? 0).toFixed(1)} MB
            </div>
          </div>
        </div>
      </div>

      {/* Ingest zone */}
      {tab === 'documents' && (
        <div
          ref={dragRef}
          onDragEnter={handleDrag}
          onDragLeave={handleDrag}
          onDragOver={handleDrag}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          style={ingestZone}
        >
          <input
            ref={fileInputRef}
            type="file"
            multiple
            style={{ display: 'none' }}
            onChange={e => ingestFiles(e.target.files)}
          />
          <FileUp size={32} color={dragActive ? ACCENT : 'var(--text-muted)'} style={{ margin: '0 auto 12px' }} />
          <p style={{ margin: 0, fontWeight: 600, color: dragActive ? ACCENT : 'var(--text)' }}>
            {uploading ? 'Ingesting…' : dragActive ? 'Drop files to ingest' : 'Drag & drop files here, or click to choose'}
          </p>
          <p style={{ margin: '4px 0 0 0', fontSize: '0.875rem', color: 'var(--text-muted)' }}>
            Bank statements (CSV/OFX), tax forms (W-2, 1099s), credit card PDFs
          </p>
          {uploadNote && (
            <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, color: ACCENT }}>
              <CheckCircle2 size={16} />
              <span style={{ fontSize: '0.875rem', fontWeight: 600 }}>{uploadNote}</span>
            </div>
          )}
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: '1.5rem', borderBottom: '1px solid var(--border)', paddingBottom: '1rem', flexWrap: 'wrap' }}>
        {(['documents', 'ledger', 'review', 'bills', 'worksheets', 'package'] as TabMode[]).map(t => (
          <button key={t} onClick={() => setTab(t)} style={tabStyle(tab === t)}>
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {error && (
        <div
          style={{
            padding: '12px 16px',
            borderRadius: 6,
            background: 'rgba(239, 68, 68, 0.1)',
            border: `1px solid ${ERROR}`,
            color: ERROR,
            marginBottom: '1rem',
            fontSize: '0.875rem',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <span>{error}</span>
          <button onClick={() => setError('')} style={{ background: 'none', border: 'none', color: ERROR, cursor: 'pointer', fontSize: '1.25rem' }}>
            ×
          </button>
        </div>
      )}

      <div style={{ minHeight: 400 }}>
        {/* ── DOCUMENTS ── */}
        {tab === 'documents' &&
          asyncBody(documents, 'No documents ingested yet. Drop statements or forms above.', data => {
            const docs = data.documents || []
            if (!docs.length) {
              return <div style={{ ...panelBox, textAlign: 'center', color: 'var(--text-muted)' }}>No documents yet.</div>
            }
            return (
              <div style={{ ...panelBox, ...scrollX }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={th}>File</th>
                      <th style={th}>Type</th>
                      <th style={th}>Status</th>
                      <th style={th}>Transactions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {docs.map((d: any, i: number) => (
                      <tr key={d.doc_id || i}>
                        <td style={td}>{d.filename || d.doc_id}</td>
                        <td style={td}>{d.doc_type || d.type || '—'}</td>
                        <td style={{ ...td, color: d.status === 'error' ? ERROR : 'inherit' }}>
                          {d.status || '—'}
                          {d.error ? ` — ${d.error}` : ''}
                        </td>
                        <td style={td}>{d.txn_count ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          })}

        {/* ── LEDGER ── */}
        {tab === 'ledger' && (
          <div>
            <div style={{ marginBottom: 12, display: 'flex', gap: 8 }}>
              <button
                style={btn}
                onClick={async () => {
                  setLedger({ data: null, loading: true, error: '' })
                  try {
                    await api('/build-ledger', { method: 'POST' })
                    await loadStats()
                    await loadInto(setLedger, '/ledger-summary?year=0')
                  } catch (e) {
                    setLedger({ data: null, loading: false, error: e instanceof Error ? e.message : String(e) })
                  }
                }}
              >
                Rebuild ledger
              </button>
            </div>
            {asyncBody(ledger, 'No ledger yet — ingest documents, then rebuild.', data => {
              const months = data.monthly_totals || []
              const grand = data.grand_total || {}
              return (
                <div style={{ ...panelBox, ...scrollX }}>
                  <div style={{ display: 'flex', gap: 24, marginBottom: 16, flexWrap: 'wrap' }}>
                    <div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Inflow</div>
                      <div style={{ fontSize: '1.25rem', fontWeight: 700, color: ACCENT }}>{money(grand.inflow)}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Outflow</div>
                      <div style={{ fontSize: '1.25rem', fontWeight: 700 }}>{money(grand.outflow)}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Net</div>
                      <div style={{ fontSize: '1.25rem', fontWeight: 700 }}>{money(grand.net)}</div>
                    </div>
                  </div>
                  {months.length === 0 ? (
                    <div style={{ color: 'var(--text-muted)' }}>Ledger is empty.</div>
                  ) : (
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr>
                          <th style={th}>Month</th>
                          <th style={th}>Inflow</th>
                          <th style={th}>Outflow</th>
                          <th style={th}>Net</th>
                          <th style={th}>Txns</th>
                        </tr>
                      </thead>
                      <tbody>
                        {months.map((m: any) => (
                          <tr key={m.month}>
                            <td style={td}>{m.month}</td>
                            <td style={td}>{money(m.inflow)}</td>
                            <td style={td}>{money(m.outflow)}</td>
                            <td style={td}>{money(m.net)}</td>
                            <td style={td}>{m.txn_count}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* ── REVIEW ── */}
        {tab === 'review' && (
          <div>
            <div style={{ marginBottom: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                style={btn}
                onClick={async () => {
                  try {
                    await api('/bulk-approve?min_confidence=0.95&limit=200', { method: 'POST' })
                    await loadStats()
                    await loadInto(setReview, '/review-queue?limit=50')
                  } catch (e) {
                    setError(`Bulk approve failed: ${e instanceof Error ? e.message : String(e)}`)
                  }
                }}
              >
                Approve high-confidence (≥0.95)
              </button>
            </div>
            {asyncBody(review, 'Nothing awaiting review.', data => {
              const queue = data.review_queue || []
              if (!queue.length) {
                return <div style={{ ...panelBox, textAlign: 'center', color: 'var(--text-muted)' }}>All transactions reviewed.</div>
              }
              return (
                <div style={{ ...panelBox, ...scrollX }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr>
                        <th style={th}>Date</th>
                        <th style={th}>Merchant</th>
                        <th style={th}>Amount</th>
                        <th style={th}>Suggested</th>
                        <th style={th}>Confidence</th>
                      </tr>
                    </thead>
                    <tbody>
                      {queue.map((t: any) => (
                        <tr key={t.txn_id}>
                          <td style={td}>{t.date}</td>
                          <td style={td}>{t.merchant}</td>
                          <td style={td}>{money(t.amount)}</td>
                          <td style={td}>
                            {t.suggested?.expense_category || t.suggested?.tax_class || '—'}
                          </td>
                          <td style={td}>
                            {typeof t.suggested?.confidence === 'number'
                              ? `${Math.round(t.suggested.confidence * 100)}%`
                              : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            })}
          </div>
        )}

        {/* ── BILLS ── */}
        {tab === 'bills' &&
          asyncBody(bills, 'No recurring charges detected yet.', data => {
            const subs = data.subscriptions || data.active_subscriptions || []
            const hikes = data.price_hikes || []
            return (
              <div style={{ display: 'grid', gap: 16 }}>
                <div style={{ ...panelBox, ...scrollX }}>
                  <h3 style={{ margin: '0 0 12px 0', fontSize: 16 }}>Subscriptions</h3>
                  {subs.length === 0 ? (
                    <div style={{ color: 'var(--text-muted)' }}>None detected.</div>
                  ) : (
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr>
                          <th style={th}>Merchant</th>
                          <th style={th}>Cadence</th>
                          <th style={th}>Monthly est.</th>
                        </tr>
                      </thead>
                      <tbody>
                        {subs.map((s: any, i: number) => (
                          <tr key={s.merchant || i}>
                            <td style={td}>{s.merchant}</td>
                            <td style={td}>{s.cadence || '—'}</td>
                            <td style={td}>{money(s.monthly_estimate ?? s.amount)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
                {hikes.length > 0 && (
                  <div style={{ ...panelBox, ...scrollX }}>
                    <h3 style={{ margin: '0 0 12px 0', fontSize: 16, color: WARNING }}>Price hikes</h3>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr>
                          <th style={th}>Merchant</th>
                          <th style={th}>Was</th>
                          <th style={th}>Now</th>
                        </tr>
                      </thead>
                      <tbody>
                        {hikes.map((h: any, i: number) => (
                          <tr key={h.merchant || i}>
                            <td style={td}>{h.merchant}</td>
                            <td style={td}>{money(h.old_amount)}</td>
                            <td style={{ ...td, color: WARNING }}>{money(h.new_amount)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )
          })}

        {/* ── WORKSHEETS ── */}
        {tab === 'worksheets' && (
          <div>
            <div style={{ ...panelBox, marginBottom: 16 }}>
              <h3 style={{ margin: '0 0 12px 0', fontSize: 16 }}>Filing profile</h3>
              <p style={{ margin: '0 0 12px 0', fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
                These drive the standard deduction and bracket math. Getting filing status wrong
                produces a complete, confident, wrong return.
              </p>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <label style={{ fontSize: '0.8125rem' }}>
                  <div style={{ color: 'var(--text-muted)', marginBottom: 4 }}>Filing status</div>
                  <select
                    value={filingStatus}
                    onChange={e => setFilingStatus(e.target.value)}
                    style={{ padding: '6px 10px', borderRadius: 6, background: 'var(--bg-deep)', color: 'var(--text)', border: '1px solid var(--border)' }}
                  >
                    {FILING_STATUSES.map(f => (
                      <option key={f.value} value={f.value}>
                        {f.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label style={{ fontSize: '0.8125rem' }}>
                  <div style={{ color: 'var(--text-muted)', marginBottom: 4 }}>Tax year</div>
                  <select
                    value={taxYear}
                    onChange={e => setTaxYear(Number(e.target.value))}
                    style={{ padding: '6px 10px', borderRadius: 6, background: 'var(--bg-deep)', color: 'var(--text)', border: '1px solid var(--border)' }}
                  >
                    <option value={2025}>2025</option>
                    <option value={2026}>2026 (projected constants)</option>
                  </select>
                </label>
                <label style={{ fontSize: '0.8125rem' }}>
                  <div style={{ color: 'var(--text-muted)', marginBottom: 4 }}>State flat rate</div>
                  <input
                    value={stateRate}
                    onChange={e => setStateRate(e.target.value)}
                    placeholder="0.05"
                    style={{ padding: '6px 10px', width: 90, borderRadius: 6, background: 'var(--bg-deep)', color: 'var(--text)', border: '1px solid var(--border)' }}
                  />
                </label>
                <button style={btn} onClick={() => loadInto(setWorksheet, `/worksheet-1040${worksheetQuery()}`)}>
                  Compute 1040
                </button>
              </div>
            </div>
            {asyncBody(worksheet, 'Set your filing profile above, then compute.', data => {
              const s = data.summary || {}
              const rows: Array<[string, unknown]> = [
                ['Total income', s.total_income],
                ['AGI', s.agi],
                ['Taxable income', s.taxable_income],
                ['Total tax', s.total_tax],
                ['Payments', s.payments],
              ]
              const owed = Number(s.refund_or_owed ?? 0)
              return (
                <div style={panelBox}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <tbody>
                      {rows.map(([label, val]) => (
                        <tr key={label}>
                          <td style={{ ...td, color: 'var(--text-muted)' }}>{label}</td>
                          <td style={{ ...td, textAlign: 'right', fontWeight: 600 }}>{money(val)}</td>
                        </tr>
                      ))}
                      <tr>
                        <td style={{ ...td, fontWeight: 700 }}>{owed >= 0 ? 'Refund' : 'Amount owed'}</td>
                        <td style={{ ...td, textAlign: 'right', fontWeight: 700, color: owed >= 0 ? ACCENT : WARNING }}>
                          {money(Math.abs(owed))}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                  <p style={{ marginTop: 12, fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    Draft for CPA review — TaxDesk does not file returns.
                  </p>
                </div>
              )
            })}
          </div>
        )}

        {/* ── PACKAGE ── */}
        {tab === 'package' && (
          <div>
            <div style={{ ...panelBox, marginBottom: 16 }}>
              <p style={{ margin: '0 0 12px 0', fontSize: '0.875rem', color: 'var(--text-muted)' }}>
                Generates the DOCX + XLSX package for your CPA, using the filing profile set on
                the Worksheets tab (<strong>{filingStatus}</strong>, {taxYear}).
              </p>
              <button
                style={btn}
                onClick={() => loadInto(setPkg, `/report-package${worksheetQuery()}`, { method: 'POST' })}
              >
                Generate CPA package
              </button>
            </div>
            {asyncBody(pkg, 'No package generated yet.', data => (
              <div style={panelBox}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: ACCENT, marginBottom: 12 }}>
                  <CheckCircle2 size={18} />
                  <strong>Package generated</strong>
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <tbody>
                    {Object.entries(data)
                      .filter(([, v]) => typeof v === 'string' || typeof v === 'number')
                      .map(([k, v]) => (
                        <tr key={k}>
                          <td style={{ ...td, color: 'var(--text-muted)' }}>{k}</td>
                          <td style={{ ...td, wordBreak: 'break-all' }}>{String(v)}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
