'use client'

/**
 * ThemisLegalPanel — contract review & legal document desk (product: themis-legal)
 *
 * Four tabs over the Genesis Themis Legal router (Layer 2):
 *   Analyze   — paste or load a contract, get the clause findings (severity,
 *               excerpt, risk, suggested redline) from the deterministic engine
 *   Documents — upload / list / delete ingested legal documents
 *   Search    — keyword search over the ingested documents
 *   Draft     — negotiation / dispute letter draft
 *
 * ENDPOINT CONTRACT (relative to `apiBase`, default
 * `/api/bridge/genesis/api/v1/themis-legal`), mirroring the Layer 2 router
 * `apps/AitherGenesis/routers/themis_legal.py`. Paths, JSON body field names and
 * query parameter names are asserted against that router's pydantic models and
 * `Query(...)` args by `dev/tests/test_themis_legal_panel.py` — change both sides
 * together:
 *   POST   /analyze          {text, party}                      -> analysis result
 *   GET    /documents                                           -> {documents, count}
 *   POST   /documents        {text, filename, doc_type}         -> {doc_id, char_count, ...}
 *   DELETE /documents/{id}                                      -> {ok, deleted}
 *   GET    /search?q=&top_k=                                    -> {results, query, count}
 *   POST   /draft-letter     {situation, desired_outcome, tone} -> {letter, ...}
 *
 * Uploads are TEXT only (.txt/.md, read in the browser): the router stores
 * `text` and has no binary/PDF/DOCX extractor, so the panel refuses those files
 * with a clear message instead of sending bytes nothing can receive.
 *
 * PRO GATE: the router is fail-closed on the `themis_legal` entitlement and
 * answers 402/403. There is no separate check-entitlement probe to drift out
 * of sync — the first real read (GET /documents) decides, and a 402/403 from
 * ANY call flips the panel to the upgrade view. A 402/403 is never rendered as
 * a backend error, and a backend error is never rendered as "not entitled".
 *
 * Tenant scoping is server-side from the authenticated caller; this panel
 * sends no tenant/user ids and must not start to.
 *
 * States stay DISTINCT: loading, failed, and genuinely-empty never render the
 * same, because a silent empty is how a broken read plane passes for "no
 * documents yet". Output is analysis to focus a reader, not legal advice.
 */

import React, { useCallback, useEffect, useState } from 'react'
import { AlertCircle, FileText, Lock, RefreshCw, Search, Trash2, Upload } from 'lucide-react'

type TabMode = 'analyze' | 'documents' | 'search' | 'draft'

type Gate = 'checking' | 'entitled' | 'signin' | 'upgrade' | 'error'

interface Finding {
  severity?: string
  clause_type?: string
  title?: string
  excerpt?: string
  risk?: string
  redline?: string
}

interface AnalysisResult {
  counts?: Record<string, number>
  paragraphs_scanned?: number
  clean_dimensions?: string[]
  findings?: Finding[]
  error?: string
}

interface LegalDocument {
  doc_id: string
  filename?: string
  doc_type?: string
  ingested_at?: string
  char_count?: number
}

interface SearchHit {
  doc_id: string
  filename?: string
  score?: number
  excerpt?: string
}

interface ThemisLegalPanelProps {
  apiBase?: string
}

/** Thrown for 402/403 so every caller can route it to the upgrade view. */
export class NotEntitledError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NotEntitledError'
  }
}

/** Thrown for 401: the router requires an authenticated caller; route to the sign-in view. */
export class NotSignedInError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NotSignedInError'
  }
}

const ACCENT = '#6366f1'
const SEVERITY_COLOR: Record<string, string> = {
  CRITICAL: '#dc2626',
  HIGH: '#ea580c',
  MEDIUM: '#d97706',
  LOW: '#65a30d',
}
const SEVERITY_ORDER = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']
const DOC_TYPES = ['contract', 'amendment', 'nda', 'lease', 'terms', 'memo', 'other']
const TONES = [
  { value: 'firm_but_professional', label: 'Firm but professional' },
  { value: 'collaborative', label: 'Collaborative' },
  { value: 'assertive', label: 'Assertive' },
]
/** The router's `max_length` on `text` (analyze + store); larger inputs are refused client-side. */
const MAX_TEXT_CHARS = 200_000
/** Files the router can store: it takes extracted text, not PDF/DOCX bytes. */
const TEXT_FILE_RE = /\.(txt|md|text)$/i

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e))

/**
 * A readable message from an error body. FastAPI validation errors (422) carry
 * `detail` as a LIST of `{loc, msg}`; router errors carry an object with
 * `message`/`error`; plain HTTPExceptions carry a string.
 */
export function detailMessage(body: any): string {
  const detail = body?.detail ?? body
  if (Array.isArray(detail)) {
    return detail
      .map((d: any) => {
        const loc = Array.isArray(d?.loc) ? d.loc.filter((p: unknown) => p !== 'body').join('.') : ''
        const msg = typeof d?.msg === 'string' ? d.msg : JSON.stringify(d)
        return loc ? `${loc}: ${msg}` : msg
      })
      .join('; ')
  }
  if (typeof detail === 'string') return detail
  if (detail && typeof detail === 'object') {
    const m = detail.message || detail.error
    if (typeof m === 'string') return m
  }
  return ''
}

export default function ThemisLegalPanel({
  apiBase = '/api/bridge/genesis/api/v1/themis-legal',
}: ThemisLegalPanelProps) {
  const [tab, setTab] = useState<TabMode>('analyze')
  const [gate, setGate] = useState<Gate>('checking')
  const [gateError, setGateError] = useState('')

  // Analyze
  const [contractText, setContractText] = useState('')
  const [party, setParty] = useState('reviewer')
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [analyzeError, setAnalyzeError] = useState('')
  const [severityFilter, setSeverityFilter] = useState<string>('ALL')

  // Documents
  const [docs, setDocs] = useState<LegalDocument[] | null>(null)
  const [docsLoading, setDocsLoading] = useState(false)
  const [docsError, setDocsError] = useState('')
  const [docType, setDocType] = useState('contract')
  const [uploading, setUploading] = useState(false)
  const [uploadNote, setUploadNote] = useState('')

  // Search
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<SearchHit[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState('')

  // Draft
  const [situation, setSituation] = useState('')
  const [outcome, setOutcome] = useState('')
  const [tone, setTone] = useState('firm_but_professional')
  const [letter, setLetter] = useState('')
  const [drafting, setDrafting] = useState(false)
  const [draftError, setDraftError] = useState('')

  /**
   * One request helper: 402/403 -> NotEntitledError, other non-2xx -> Error
   * carrying the server's own message, and a 200 whose body is `{error}` (the
   * pack tools report failure that way) is a failure too, not a result.
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
      const serverMsg = detailMessage(body)
      if (res.status === 401) {
        throw new NotSignedInError(serverMsg || 'Sign in to use Themis Legal')
      }
      if (res.status === 402 || res.status === 403) {
        throw new NotEntitledError(serverMsg || 'Themis Legal requires the Pro plan')
      }
      if (!res.ok) throw new Error(serverMsg || `HTTP ${res.status}`)
      if (body && typeof body === 'object' && typeof body.error === 'string' && body.error) {
        throw new Error(body.hint ? `${body.error} — ${body.hint}` : body.error)
      }
      return body
    },
    [apiBase],
  )

  /** Route a failure: 401 -> sign-in view, entitlement -> upgrade view, else the tab's error. */
  const fail = useCallback((e: unknown, setErr: (m: string) => void) => {
    if (e instanceof NotSignedInError) {
      setGate('signin')
      return
    }
    if (e instanceof NotEntitledError) {
      setGate('upgrade')
      return
    }
    setErr(errMsg(e))
  }, [])

  const loadDocs = useCallback(async () => {
    setDocsLoading(true)
    setDocsError('')
    try {
      const body = await api('/documents')
      setDocs(Array.isArray(body?.documents) ? body.documents : [])
    } catch (e) {
      setDocs(null)
      fail(e, setDocsError)
    } finally {
      setDocsLoading(false)
    }
  }, [api, fail])

  // Entitlement probe on mount: the first real read decides.
  useEffect(() => {
    let cancelled = false
    setGate('checking')
    setGateError('')
    fetch(`${apiBase}/documents`, { cache: 'no-store' })
      .then(async (res) => {
        if (cancelled) return
        if (res.status === 401) {
          setGate('signin')
          return
        }
        if (res.status === 402 || res.status === 403) {
          setGate('upgrade')
          return
        }
        if (!res.ok) {
          const errBody = await res.json().catch(() => null)
          throw new Error(detailMessage(errBody) || `HTTP ${res.status}`)
        }
        const body = await res.json().catch(() => null)
        setDocs(Array.isArray(body?.documents) ? body.documents : [])
        setGate('entitled')
      })
      .catch((e) => {
        if (cancelled) return
        setGate('error')
        setGateError(errMsg(e))
      })
    return () => {
      cancelled = true
    }
  }, [apiBase])

  const runAnalyze = async () => {
    if (!contractText.trim()) {
      setAnalyzeError('Paste contract text or load a file first.')
      return
    }
    if (contractText.length > MAX_TEXT_CHARS) {
      setAnalyzeError(`Contract text is longer than ${MAX_TEXT_CHARS.toLocaleString()} characters`)
      return
    }
    setAnalyzing(true)
    setAnalyzeError('')
    setAnalysis(null)
    try {
      const body = await api('/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: contractText, party: party.trim() || 'reviewer' }),
      })
      setAnalysis(body)
      setSeverityFilter('ALL')
    } catch (e) {
      fail(e, setAnalyzeError)
    } finally {
      setAnalyzing(false)
    }
  }

  /** Plain-text files load straight into the Analyze box; binaries go to Documents. */
  const loadTextFile = async (file: File) => {
    if (!TEXT_FILE_RE.test(file.name)) {
      setAnalyzeError('Only .txt/.md files load here. Export PDF/DOCX to text first.')
      return
    }
    const text = await file.text()
    if (text.length > MAX_TEXT_CHARS) {
      setAnalyzeError(`${file.name} is longer than ${MAX_TEXT_CHARS.toLocaleString()} characters`)
      return
    }
    setContractText(text)
    setAnalyzeError('')
  }

  const uploadDocument = async (file: File) => {
    setUploadNote('')
    if (!TEXT_FILE_RE.test(file.name)) {
      setDocsError(
        `${file.name}: only .txt/.md documents can be stored. Export PDF/DOCX to text first.`,
      )
      return
    }
    setUploading(true)
    setDocsError('')
    try {
      const text = await file.text()
      if (!text.trim()) throw new Error(`${file.name} is empty`)
      if (text.length > MAX_TEXT_CHARS) {
        throw new Error(`${file.name} is longer than ${MAX_TEXT_CHARS.toLocaleString()} characters`)
      }
      const body = await api('/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, filename: file.name, doc_type: docType }),
      })
      setUploadNote(
        `Ingested ${body?.filename ?? file.name} (${(body?.char_count ?? 0).toLocaleString()} chars)`,
      )
      await loadDocs()
    } catch (e) {
      fail(e, setDocsError)
    } finally {
      setUploading(false)
    }
  }

  const deleteDocument = async (docId: string) => {
    setDocsError('')
    try {
      await api(`/documents/${encodeURIComponent(docId)}`, { method: 'DELETE' })
      await loadDocs()
    } catch (e) {
      fail(e, setDocsError)
    }
  }

  const runSearch = async () => {
    if (!query.trim()) return
    setSearching(true)
    setSearchError('')
    setHits(null)
    try {
      const body = await api(`/search?q=${encodeURIComponent(query.trim())}&top_k=10`)
      setHits(Array.isArray(body?.results) ? body.results : [])
    } catch (e) {
      fail(e, setSearchError)
    } finally {
      setSearching(false)
    }
  }

  const runDraft = async () => {
    if (!situation.trim() || !outcome.trim()) {
      setDraftError('Describe the situation and the outcome you want.')
      return
    }
    setDrafting(true)
    setDraftError('')
    setLetter('')
    try {
      const body = await api('/draft-letter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ situation, desired_outcome: outcome, tone }),
      })
      setLetter(typeof body?.letter === 'string' ? body.letter : '')
      if (typeof body?.letter !== 'string' || !body.letter) {
        setDraftError('The drafter returned no letter text.')
      }
    } catch (e) {
      fail(e, setDraftError)
    } finally {
      setDrafting(false)
    }
  }

  // ── Gate views ───────────────────────────────────────────────────────
  if (gate === 'checking') {
    return (
      <div className="p-6 text-sm text-gray-500 flex items-center gap-2">
        <RefreshCw className="w-4 h-4 animate-spin" /> Checking Themis Legal access…
      </div>
    )
  }
  if (gate === 'signin') {
    return (
      <div className="p-6 max-w-lg" data-testid="themis-legal-signin">
        <div className="flex items-center gap-2 text-lg font-semibold">
          <Lock className="w-5 h-5" style={{ color: ACCENT }} /> Sign in to use Themis Legal
        </div>
        <p className="mt-2 text-sm text-gray-600">
          Your session has expired or you are not signed in. Sign in, then reopen this panel.
        </p>
        <button
          className="inline-block mt-4 px-4 py-2 rounded text-white text-sm"
          style={{ background: ACCENT }}
          onClick={() => window.location.reload()}
        >
          I have signed in — retry
        </button>
      </div>
    )
  }
  if (gate === 'upgrade') {
    return (
      <div className="p-6 max-w-lg" data-testid="themis-legal-upgrade">
        <div className="flex items-center gap-2 text-lg font-semibold">
          <Lock className="w-5 h-5" style={{ color: ACCENT }} /> Themis Legal is a Pro feature
        </div>
        <p className="mt-2 text-sm text-gray-600">
          Contract review, clause detection, document search and negotiation drafts are included
          with the Pro plan.
        </p>
        <a
          href="https://aitherium.com/pricing"
          className="inline-block mt-4 px-4 py-2 rounded text-white text-sm"
          style={{ background: ACCENT }}
        >
          Upgrade to Pro
        </a>
      </div>
    )
  }
  if (gate === 'error') {
    return (
      <div className="p-6 text-sm text-red-600 flex items-start gap-2" role="alert">
        <AlertCircle className="w-4 h-4 mt-0.5" />
        <div>
          Could not reach Themis Legal: {gateError}
          <button className="ml-3 underline" onClick={() => window.location.reload()}>
            Retry
          </button>
        </div>
      </div>
    )
  }

  // ── Entitled ─────────────────────────────────────────────────────────
  const findings = analysis?.findings ?? []
  const shown =
    severityFilter === 'ALL'
      ? findings
      : findings.filter((f) => (f.severity ?? '').toUpperCase() === severityFilter)

  const ErrorLine = ({ msg }: { msg: string }) =>
    msg ? (
      <div className="mt-2 text-sm text-red-600 flex items-center gap-1" role="alert">
        <AlertCircle className="w-4 h-4" /> {msg}
      </div>
    ) : null

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Themis Legal</h2>
        <span className="text-xs text-gray-500">Analysis to focus review — not legal advice</span>
      </div>

      <div className="flex gap-2 border-b">
        {(['analyze', 'documents', 'search', 'draft'] as TabMode[]).map((t) => (
          <button
            key={t}
            onClick={() => {
              setTab(t)
              if (t === 'documents') loadDocs()
            }}
            className="px-3 py-2 text-sm capitalize"
            style={tab === t ? { borderBottom: `2px solid ${ACCENT}`, color: ACCENT } : undefined}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'analyze' && (
        <section className="space-y-3">
          <textarea
            className="w-full h-48 border rounded p-2 text-sm font-mono"
            placeholder="Paste contract text here…"
            value={contractText}
            onChange={(e) => setContractText(e.target.value)}
          />
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <label className="flex items-center gap-1">
              Protect the interests of
              <input
                className="border rounded px-2 py-1"
                value={party}
                onChange={(e) => setParty(e.target.value)}
              />
            </label>
            <label className="flex items-center gap-1 cursor-pointer">
              <FileText className="w-4 h-4" /> Load .txt
              <input
                type="file"
                accept=".txt,.md,text/plain"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && loadTextFile(e.target.files[0])}
              />
            </label>
            <button
              onClick={runAnalyze}
              disabled={analyzing}
              className="px-4 py-1.5 rounded text-white disabled:opacity-50"
              style={{ background: ACCENT }}
            >
              {analyzing ? 'Analyzing…' : 'Analyze contract'}
            </button>
          </div>
          <ErrorLine msg={analyzeError} />

          {analysis && (
            <div className="space-y-3" data-testid="themis-legal-analysis">
              <div className="flex flex-wrap gap-2 text-xs">
                {['ALL', ...SEVERITY_ORDER].map((s) => (
                  <button
                    key={s}
                    onClick={() => setSeverityFilter(s)}
                    className="px-2 py-1 rounded border"
                    style={
                      severityFilter === s
                        ? { background: SEVERITY_COLOR[s] ?? ACCENT, color: '#fff' }
                        : undefined
                    }
                  >
                    {s} {s === 'ALL' ? analysis.counts?.TOTAL ?? findings.length : analysis.counts?.[s] ?? 0}
                  </button>
                ))}
                <span className="text-gray-500 self-center">
                  {analysis.paragraphs_scanned ?? 0} paragraphs scanned
                </span>
              </div>

              {findings.length === 0 ? (
                <div className="text-sm text-green-700">
                  No risky clauses detected in the dimensions checked.
                </div>
              ) : shown.length === 0 ? (
                <div className="text-sm text-gray-500">No {severityFilter} findings.</div>
              ) : (
                <ul className="space-y-2">
                  {shown.map((f, i) => {
                    const sev = (f.severity ?? '').toUpperCase()
                    return (
                      <li
                        key={i}
                        className="border rounded p-3 text-sm"
                        style={{ borderLeft: `4px solid ${SEVERITY_COLOR[sev] ?? '#9ca3af'}` }}
                      >
                        <div className="font-medium">
                          <span style={{ color: SEVERITY_COLOR[sev] }}>{sev || 'UNRATED'}</span>{' '}
                          {f.title ?? f.clause_type}
                        </div>
                        {f.excerpt && (
                          <blockquote className="mt-1 pl-2 border-l text-gray-600 italic">
                            {f.excerpt}
                          </blockquote>
                        )}
                        {f.risk && <p className="mt-1">{f.risk}</p>}
                        {f.redline && (
                          <p className="mt-1 text-gray-700">
                            <span className="font-medium">Suggested redline:</span> {f.redline}
                          </p>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}

              {!!analysis.clean_dimensions?.length && (
                <div className="text-xs text-gray-500">
                  Clean: {analysis.clean_dimensions.join(', ')}
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {tab === 'documents' && (
        <section className="space-y-3">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <select
              className="border rounded px-2 py-1"
              value={docType}
              onChange={(e) => setDocType(e.target.value)}
            >
              {DOC_TYPES.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
            <label
              className="flex items-center gap-1 px-3 py-1.5 rounded text-white cursor-pointer"
              style={{ background: ACCENT, opacity: uploading ? 0.5 : 1 }}
            >
              <Upload className="w-4 h-4" /> {uploading ? 'Uploading…' : 'Upload document'}
              <input
                type="file"
                accept=".txt,.md,text/plain,text/markdown"
                className="hidden"
                disabled={uploading}
                onChange={(e) => e.target.files?.[0] && uploadDocument(e.target.files[0])}
              />
            </label>
            <button onClick={loadDocs} className="flex items-center gap-1 text-gray-600">
              <RefreshCw className="w-4 h-4" /> Refresh
            </button>
          </div>
          {uploadNote && <div className="text-sm text-green-700">{uploadNote}</div>}
          <ErrorLine msg={docsError} />
          {docsLoading ? (
            <div className="text-sm text-gray-500">Loading documents…</div>
          ) : docs === null ? null : docs.length === 0 ? (
            <div className="text-sm text-gray-500">No documents ingested yet.</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500">
                  <th className="py-1">File</th>
                  <th>Type</th>
                  <th>Ingested</th>
                  <th>Chars</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {docs.map((d) => (
                  <tr key={d.doc_id} className="border-t">
                    <td className="py-1">{d.filename ?? d.doc_id.slice(0, 12)}</td>
                    <td>{d.doc_type ?? '—'}</td>
                    <td>{d.ingested_at ? new Date(d.ingested_at).toLocaleString() : '—'}</td>
                    <td>{(d.char_count ?? 0).toLocaleString()}</td>
                    <td>
                      <button
                        aria-label={`Delete ${d.filename ?? d.doc_id}`}
                        onClick={() => deleteDocument(d.doc_id)}
                        className="text-red-600"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      {tab === 'search' && (
        <section className="space-y-3">
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              runSearch()
            }}
          >
            <input
              className="flex-1 border rounded px-2 py-1 text-sm"
              placeholder="Search ingested documents (e.g. indemnify renewal)"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <button
              type="submit"
              disabled={searching || !query.trim()}
              className="flex items-center gap-1 px-3 py-1.5 rounded text-white text-sm disabled:opacity-50"
              style={{ background: ACCENT }}
            >
              <Search className="w-4 h-4" /> {searching ? 'Searching…' : 'Search'}
            </button>
          </form>
          <ErrorLine msg={searchError} />
          {hits !== null &&
            (hits.length === 0 ? (
              <div className="text-sm text-gray-500">No matches.</div>
            ) : (
              <ul className="space-y-2">
                {hits.map((h) => (
                  <li key={h.doc_id} className="border rounded p-2 text-sm">
                    <div className="font-medium">
                      {h.filename ?? h.doc_id.slice(0, 12)}{' '}
                      <span className="text-xs text-gray-500">score {h.score ?? 0}</span>
                    </div>
                    {h.excerpt && <p className="text-gray-600 mt-1">{h.excerpt}</p>}
                  </li>
                ))}
              </ul>
            ))}
        </section>
      )}

      {tab === 'draft' && (
        <section className="space-y-3 text-sm">
          <textarea
            className="w-full h-24 border rounded p-2"
            placeholder="The situation (what happened, which clause, what the other side wants)…"
            value={situation}
            onChange={(e) => setSituation(e.target.value)}
          />
          <textarea
            className="w-full h-16 border rounded p-2"
            placeholder="The outcome you want…"
            value={outcome}
            onChange={(e) => setOutcome(e.target.value)}
          />
          <div className="flex items-center gap-3">
            <select
              className="border rounded px-2 py-1"
              value={tone}
              onChange={(e) => setTone(e.target.value)}
            >
              {TONES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
            <button
              onClick={runDraft}
              disabled={drafting}
              className="px-4 py-1.5 rounded text-white disabled:opacity-50"
              style={{ background: ACCENT }}
            >
              {drafting ? 'Drafting…' : 'Draft letter'}
            </button>
          </div>
          <ErrorLine msg={draftError} />
          {letter && (
            <pre className="whitespace-pre-wrap border rounded p-3 bg-gray-50" data-testid="themis-legal-letter">
              {letter}
            </pre>
          )}
        </section>
      )}
    </div>
  )
}
