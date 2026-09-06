'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { useAuth } from '../hooks/useAuth'

interface Doc {
  id: string
  filename: string
  doc_type: string
  uploaded_at: string | null
}

interface PageInfo {
  index: number
  width: number
  height: number
}

interface SigBlock {
  page: number
  labels: Record<string, [number, number, number, number]>
  filled?: boolean
}

interface DocInfo {
  id: string
  filename: string
  page_count: number
  pages: PageInfo[]
  signature_blocks: SigBlock[]
}

interface Placement {
  block?: number
  page?: number
  x?: number
  y?: number
}

interface ShareRow {
  id: string
  doc_id: string
  filename: string
  signer_name: string
  signer_email: string
  status: string
  effective_status?: string
  created_at: string
  expires_at: string
  viewed_at: string | null
  signed_at: string | null
  view_count: number
  signed_doc_id: string | null
  envelope_id?: string | null
  signer_order?: number
  reminder_count?: number
}

type ShareEntry =
  | { kind: 'single'; share: ShareRow }
  | { kind: 'envelope'; envelopeId: string; rows: ShareRow[] }

interface SignerDraft {
  name: string
  email: string
}

interface ResultSigner {
  name: string
  email: string
  order: number
  status: string
}

interface ShareModalTarget {
  docId: string
  filename: string
  prefillName?: string
  prefillEmail?: string
}

export default function ESignPanel() {
  const auth = useAuth()
  const [docs, setDocs] = useState<Doc[]>([])
  const [uploading, setUploading] = useState(false)
  const [viewDoc, setViewDoc] = useState<Doc | null>(null)
  const [info, setInfo] = useState<DocInfo | null>(null)
  const [loadingInfo, setLoadingInfo] = useState(false)
  const [placement, setPlacement] = useState<Placement | null>(null)
  const [signName, setSignName] = useState('')
  const [signTitle, setSignTitle] = useState('')
  const [signDate, setSignDate] = useState('')
  const [signing, setSigning] = useState(false)
  const [signedResult, setSignedResult] = useState<{ filename: string; download_url: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [visibleCount, setVisibleCount] = useState(10)
  const [shares, setShares] = useState<ShareRow[]>([])
  const [sharesOpen, setSharesOpen] = useState(true)
  const [shareError, setShareError] = useState<string | null>(null)
  const [shareModal, setShareModal] = useState<ShareModalTarget | null>(null)
  const [revokingId, setRevokingId] = useState<string | null>(null)
  const [importingId, setImportingId] = useState<string | null>(null)
  const [resendingId, setResendingId] = useState<string | null>(null)
  const [resendResult, setResendResult] = useState<{ shareId: string; link: string; emailSent: boolean } | null>(null)
  const [resendCopied, setResendCopied] = useState(false)
  const autoImportTried = useRef(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const fetchDocs = () => {
    fetch('/api/documents')
      .then(r => r.json())
      .then(data => {
        // FastAPI backends return {documents:[{id,...}]}; Veil/Genesis returns {documents:[{doc_id,...}]}
        const raw: any[] = data.documents || data || []
        const list: Doc[] = raw.map(d => ({ ...d, id: d.id || d.doc_id }))
        setDocs(list.filter(d => d.id && d.filename?.toLowerCase().endsWith('.pdf')))
      })
      .catch(() => {})
  }

  const fetchShares = () => {
    fetch('/api/esign/shares')
      .then(r => (r.ok ? r.json() : Promise.reject()))
      .then(data => {
        const raw: any[] = data.shares || data || []
        if (Array.isArray(raw)) setShares(raw as ShareRow[])
      })
      .catch(() => {})
  }

  useEffect(() => { fetchDocs(); fetchShares() }, [])

  // Auto-import signed-but-not-yet-ingested shares once per panel load.
  // For envelopes only the FINAL signer's share (once the whole envelope is
  // complete) holds the sealed document, so only that share is imported.
  useEffect(() => {
    if (autoImportTried.current || shares.length === 0) return
    autoImportTried.current = true
    const pending: ShareRow[] = []
    for (const entry of groupShares(shares)) {
      if (entry.kind === 'single') {
        if (shareStatus(entry.share) === 'signed' && !entry.share.signed_doc_id) pending.push(entry.share)
      } else {
        const final = envelopeImportCandidate(entry.rows)
        if (final && !final.signed_doc_id) pending.push(final)
      }
    }
    if (pending.length === 0) return
    Promise.allSettled(
      pending.map(s => fetch(`/api/esign/shares/${s.id}/import`, { method: 'POST' }))
    ).then(results => {
      if (results.some(r => r.status === 'fulfilled' && r.value.ok)) {
        fetchShares()
        fetchDocs()
      }
    })
  }, [shares])  // eslint-disable-line react-hooks/exhaustive-deps

  const revokeShare = async (id: string, isEnvelope: boolean) => {
    const msg = isEnvelope
      ? 'Revoke this envelope? This cancels ALL remaining signers - none of them will be able to open their links.'
      : 'Revoke this signature link? The signer will no longer be able to open it.'
    if (!window.confirm(msg)) return
    setRevokingId(id)
    setShareError(null)
    try {
      const resp = await fetch(`/api/esign/shares/${id}/revoke`, { method: 'POST' })
      if (resp.ok) fetchShares()
      else {
        const err = await resp.json().catch(() => ({}))
        setShareError(err.detail || `Revoke failed (${resp.status})`)
      }
    } catch { setShareError('Revoke failed (network error)') }
    finally { setRevokingId(null) }
  }

  const resendShare = async (s: ShareRow) => {
    if (!window.confirm(`Resend the signature link to ${s.signer_email}? This invalidates the previous link and resets any verification the signer completed.`)) return
    setResendingId(s.id)
    setShareError(null)
    setResendResult(null)
    setResendCopied(false)
    try {
      const resp = await fetch(`/api/esign/shares/${s.id}/resend`, { method: 'POST' })
      const data = await resp.json().catch(() => ({}))
      if (resp.ok) {
        setResendResult({ shareId: s.id, link: data.link || '', emailSent: data.email_sent !== false })
        fetchShares()
      } else if (resp.status === 429) {
        setShareError('Wait a minute between resends')
      } else {
        setShareError(data.detail || `Resend failed (${resp.status})`)
      }
    } catch { setShareError('Resend failed (network error)') }
    finally { setResendingId(null) }
  }

  const copyResendLink = () => {
    if (!resendResult?.link) return
    navigator.clipboard?.writeText(resendResult.link)
      .then(() => {
        setResendCopied(true)
        setTimeout(() => setResendCopied(false), 2000)
      })
      .catch(() => {})
  }

  // Fresh one-time link box shown after a successful resend (same rules as creation)
  const renderResendResult = () => resendResult && (
    <div style={{ marginTop: '0.35rem' }}>
      <div style={{ display: 'flex', gap: '0.4rem' }}>
        <input readOnly value={resendResult.link} onFocus={e => e.target.select()}
          style={{ flex: 1, minWidth: 0, padding: '0.25rem 0.4rem',
            background: 'var(--bg-surface, #12121e)', border: '1px solid var(--glass-border, #333)',
            borderRadius: 4, color: 'var(--text-primary, #ddd)', fontSize: '0.62rem' }} />
        <button onClick={copyResendLink} className="btn btn-primary" style={{ fontSize: '0.65rem' }}>
          {resendCopied ? 'Copied!' : 'Copy'}
        </button>
      </div>
      <div style={{ fontSize: '0.6rem', color: 'var(--accent-coral, #f59e0b)', marginTop: '0.2rem' }}>
        This link is shown only once - copy it now if you want to keep it.
      </div>
      {resendResult.emailSent ? (
        <div style={{ fontSize: '0.62rem', color: '#22c55e', marginTop: '0.15rem' }}>
          Fresh link emailed to the signer
        </div>
      ) : (
        <div style={{ fontSize: '0.62rem', color: 'var(--accent-coral, #ef4444)', marginTop: '0.15rem' }}>
          Email failed to send - copy the link and send it yourself.
        </div>
      )}
    </div>
  )

  const importShare = async (id: string) => {
    setImportingId(id)
    setShareError(null)
    try {
      const resp = await fetch(`/api/esign/shares/${id}/import`, { method: 'POST' })
      if (resp.ok) {
        fetchShares()
        fetchDocs()
      } else {
        const err = await resp.json().catch(() => ({}))
        setShareError(err.detail || `Import failed (${resp.status})`)
      }
    } catch { setShareError('Import failed (network error)') }
    finally { setImportingId(null) }
  }

  useEffect(() => {
    if (auth.user?.display_name && !signName) setSignName(auth.user.display_name)
  }, [auth.user])  // eslint-disable-line react-hooks/exhaustive-deps

  const openDoc = async (doc: Doc) => {
    setViewDoc(doc)
    setInfo(null)
    setPlacement(null)
    setSignedResult(null)
    setError(null)
    setVisibleCount(10)
    setLoadingInfo(true)
    try {
      const r = await fetch(`/api/esign/${doc.id}/info`)
      if (r.ok) setInfo(await r.json())
      else setError('Could not load PDF (is it a valid PDF file?)')
    } catch {
      setError('Could not load PDF')
    } finally {
      setLoadingInfo(false)
    }
  }

  const uploadFile = async (file: File) => {
    setUploading(true)
    const form = new FormData()
    form.append('file', file)
    form.append('doc_type', 'contract')
    try {
      const resp = await fetch('/api/documents/upload', { method: 'POST', body: form })
      if (resp.ok) {
        const data = await resp.json()
        fetchDocs()
        openDoc({ id: data.id || data.doc_id, filename: data.filename, doc_type: 'contract', uploaded_at: null })
      } else {
        const err = await resp.json().catch(() => ({}))
        setError(err.detail || `Upload failed (${resp.status})`)
      }
    } catch { setError('Upload error') }
    finally { setUploading(false) }
  }

  const handlePageClick = useCallback((e: React.MouseEvent<HTMLImageElement>, pageIndex: number) => {
    const rect = e.currentTarget.getBoundingClientRect()
    setPlacement({
      page: pageIndex,
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top) / rect.height,
    })
    setSignedResult(null)
  }, [])

  const doSign = async () => {
    if (!viewDoc || !placement) return
    setSigning(true)
    setError(null)
    try {
      const resp = await fetch(`/api/esign/${viewDoc.id}/sign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: signName,
          title: signTitle,
          date_text: signDate,
          ...placement,
        }),
      })
      if (resp.ok) {
        const data = await resp.json()
        setSignedResult(data)
        setPlacement(null)
        fetchDocs()
      } else {
        const err = await resp.json().catch(() => ({}))
        const detail = err.detail || `Signing failed (${resp.status})`
        setError(resp.status === 401 || resp.status === 403
          ? `${detail} — Sign in with a full account to e-sign documents.`
          : detail)
      }
    } catch { setError('Signing failed (network error)') }
    finally { setSigning(false) }
  }

  const blocksForPage = (pageIndex: number): { block: SigBlock; index: number }[] =>
    (info?.signature_blocks || [])
      .map((block, index) => ({ block, index }))
      .filter(({ block }) => block.page === pageIndex)

  return (
    <div style={{ display: 'flex', height: '100vh', minHeight: 0 }}>
      {/* Doc list */}
      <div style={{ width: 280, flexShrink: 0, overflowY: 'auto', padding: '1rem',
        borderRight: '1px solid var(--glass-border, #333)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
          <h2 style={{ fontSize: '1.1rem', fontWeight: 700, margin: 0 }}>E-Sign</h2>
          <button onClick={() => fileRef.current?.click()} disabled={uploading}
            className="btn btn-primary" style={{ fontSize: '0.8rem' }}>
            {uploading ? 'Uploading...' : 'Upload PDF'}
          </button>
        </div>
        <input ref={fileRef} type="file" hidden accept=".pdf"
          onChange={e => { if (e.target.files?.[0]) uploadFile(e.target.files[0]); e.target.value = '' }} />

        {/* Pending signatures (external share links) */}
        {(shares.length > 0 || shareError) && (
          <div style={{ marginBottom: '0.9rem' }}>
            <button onClick={() => setSharesOpen(o => !o)} style={{
              display: 'flex', alignItems: 'center', gap: '0.3rem', width: '100%',
              padding: 0, background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--text-primary, #ddd)', fontSize: '0.8rem', fontWeight: 600, textAlign: 'left' }}>
              <span>{sharesOpen ? '▾' : '▸'}</span>
              <span>Signature requests ({shares.length})</span>
            </button>
            {shareError && (
              <div style={{ marginTop: '0.35rem', padding: '0.3rem 0.5rem', background: 'rgba(239,68,68,0.12)',
                color: 'var(--accent-coral, #ef4444)', fontSize: '0.7rem', borderRadius: 4 }}>{shareError}</div>
            )}
            {sharesOpen && shares.length > 0 && (
              <div style={{ display: 'grid', gap: '0.35rem', marginTop: '0.4rem' }}>
                {groupShares(shares).map(entry => {
                  if (entry.kind === 'envelope') {
                    const rows = entry.rows
                    const first = rows[0]
                    const signedCount = rows.filter(r => shareStatus(r) === 'signed').length
                    const activeRow = rows.find(r => ['pending', 'viewed', 'waiting'].includes(shareStatus(r)))
                    const finalShare = envelopeImportCandidate(rows)
                    const signedDoc = finalShare?.signed_doc_id
                      ? docs.find(d => d.id === finalShare.signed_doc_id) : undefined
                    return (
                      <div key={`env-${entry.envelopeId}`} style={{
                        padding: '0.45rem 0.55rem',
                        background: 'var(--bg-surface, #1a1a2e)',
                        border: '1px solid var(--glass-border, #333)',
                        borderRadius: 'var(--radius, 6px)',
                      }}>
                        <div style={{ fontSize: '0.72rem', fontWeight: 500, overflow: 'hidden',
                          textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={first.filename}>
                          {first.filename}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', flexWrap: 'wrap',
                          marginTop: '0.25rem', fontSize: '0.62rem', color: 'var(--text-muted, #666)' }}>
                          <span style={{ padding: '0.05rem 0.4rem', borderRadius: 999, fontWeight: 600,
                            background: 'rgba(139,92,246,0.15)', color: '#a78bfa' }}>
                            Envelope - {signedCount} of {rows.length} signed
                          </span>
                          <span>created {fmtDate(first.created_at)}</span>
                          <span>expires {fmtDate(first.expires_at)}</span>
                        </div>
                        <div style={{ display: 'grid', gap: '0.2rem', marginTop: '0.3rem' }}>
                          {rows.map((r, i) => {
                            const eff = shareStatus(r)
                            const chip = SHARE_STATUS_STYLES[eff] || SHARE_STATUS_STYLES.pending
                            const canResend = eff === 'pending' || eff === 'viewed'
                            return (
                              <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem',
                                fontSize: '0.65rem', color: 'var(--text-muted, #888)' }}>
                                <span style={{ fontWeight: 600, flexShrink: 0 }}>{r.signer_order || i + 1}.</span>
                                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap' }} title={`${r.signer_name} <${r.signer_email}>`}>
                                  {r.signer_name} - {r.signer_email}
                                </span>
                                {(r.reminder_count || 0) > 0 && (
                                  <span style={{ fontSize: '0.58rem', flexShrink: 0 }}>resent {r.reminder_count}x</span>
                                )}
                                <span style={{ padding: '0.05rem 0.4rem', borderRadius: 999, fontWeight: 600,
                                  fontSize: '0.6rem', flexShrink: 0, background: chip.bg, color: chip.fg }}>{eff}</span>
                                {canResend && (
                                  <button onClick={() => resendShare(r)} disabled={resendingId === r.id}
                                    style={{ ...shareActionStyle, flexShrink: 0 }}>
                                    {resendingId === r.id ? 'Resending...' : 'Resend'}
                                  </button>
                                )}
                              </div>
                            )
                          })}
                        </div>
                        <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', marginTop: '0.3rem' }}>
                          {activeRow && (
                            <button onClick={() => revokeShare(activeRow.id, true)}
                              disabled={revokingId === activeRow.id} style={shareActionStyle}>
                              {revokingId === activeRow.id ? 'Revoking...' : 'Revoke envelope'}
                            </button>
                          )}
                          {finalShare && !finalShare.signed_doc_id && (
                            <button onClick={() => importShare(finalShare.id)} disabled={importingId === finalShare.id}
                              className="btn btn-primary" style={{ fontSize: '0.65rem' }}>
                              {importingId === finalShare.id ? 'Importing...' : 'Import to vault'}
                            </button>
                          )}
                          {finalShare && finalShare.signed_doc_id && (
                            signedDoc ? (
                              <button onClick={() => openDoc(signedDoc)} style={shareActionStyle}>
                                View signed document
                              </button>
                            ) : (
                              <span style={{ fontSize: '0.62rem', color: 'var(--text-muted, #888)' }}
                                title={finalShare.signed_doc_id}>
                                Imported: {finalShare.signed_doc_id.slice(0, 8)}...
                              </span>
                            )
                          )}
                        </div>
                        {resendResult && rows.some(r => r.id === resendResult.shareId) && renderResendResult()}
                      </div>
                    )
                  }
                  const s = entry.share
                  const eff = shareStatus(s)
                  const chip = SHARE_STATUS_STYLES[eff] || SHARE_STATUS_STYLES.pending
                  const signedDoc = s.signed_doc_id ? docs.find(d => d.id === s.signed_doc_id) : undefined
                  return (
                    <div key={s.id} style={{
                      padding: '0.45rem 0.55rem',
                      background: 'var(--bg-surface, #1a1a2e)',
                      border: '1px solid var(--glass-border, #333)',
                      borderRadius: 'var(--radius, 6px)',
                    }}>
                      <div style={{ fontSize: '0.72rem', fontWeight: 500, overflow: 'hidden',
                        textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={s.filename}>
                        {s.filename}
                      </div>
                      <div style={{ fontSize: '0.65rem', color: 'var(--text-muted, #888)', marginTop: '0.1rem',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                        title={`${s.signer_name} <${s.signer_email}>`}>
                        {s.signer_name} · {s.signer_email}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', flexWrap: 'wrap',
                        marginTop: '0.25rem', fontSize: '0.62rem', color: 'var(--text-muted, #666)' }}>
                        <span style={{ padding: '0.05rem 0.4rem', borderRadius: 999, fontWeight: 600,
                          background: chip.bg, color: chip.fg }}>{eff}</span>
                        <span>created {fmtDate(s.created_at)}</span>
                        <span>expires {fmtDate(s.expires_at)}</span>
                        <span>{s.view_count} view{s.view_count === 1 ? '' : 's'}</span>
                        {(s.reminder_count || 0) > 0 && <span>resent {s.reminder_count}x</span>}
                      </div>
                      <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', marginTop: '0.3rem' }}>
                        {(eff === 'pending' || eff === 'viewed') && (
                          <>
                            <button onClick={() => revokeShare(s.id, false)} disabled={revokingId === s.id}
                              style={shareActionStyle}>
                              {revokingId === s.id ? 'Revoking...' : 'Revoke'}
                            </button>
                            <button onClick={() => resendShare(s)} disabled={resendingId === s.id}
                              style={shareActionStyle}>
                              {resendingId === s.id ? 'Resending...' : 'Resend'}
                            </button>
                          </>
                        )}
                        {eff === 'signed' && !s.signed_doc_id && (
                          <button onClick={() => importShare(s.id)} disabled={importingId === s.id}
                            className="btn btn-primary" style={{ fontSize: '0.65rem' }}>
                            {importingId === s.id ? 'Importing...' : 'Import to vault'}
                          </button>
                        )}
                        {eff === 'signed' && s.signed_doc_id && (
                          signedDoc ? (
                            <button onClick={() => openDoc(signedDoc)} style={shareActionStyle}>
                              View signed document
                            </button>
                          ) : (
                            <span style={{ fontSize: '0.62rem', color: 'var(--text-muted, #888)' }}
                              title={s.signed_doc_id}>
                              Imported: {s.signed_doc_id.slice(0, 8)}…
                            </span>
                          )
                        )}
                        {(eff === 'revoked' || eff === 'expired') && (
                          <button onClick={() => setShareModal({
                            docId: s.doc_id,
                            filename: s.filename,
                            prefillName: s.signer_name,
                            prefillEmail: s.signer_email,
                          })} style={shareActionStyle}>
                            Create new link
                          </button>
                        )}
                      </div>
                      {resendResult?.shareId === s.id && renderResendResult()}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {docs.length === 0 ? (
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted, #888)' }}>
            No PDFs yet. Upload a contract to sign it.
          </p>
        ) : (
          <div style={{ display: 'grid', gap: '0.35rem' }}>
            {docs.map(doc => (
              <div key={doc.id} onClick={() => openDoc(doc)} style={{
                padding: '0.5rem 0.6rem',
                background: viewDoc?.id === doc.id ? 'var(--bg-elevated, #2a2a3e)' : 'var(--bg-surface, #1a1a2e)',
                borderRadius: 'var(--radius, 6px)',
                border: viewDoc?.id === doc.id ? '1px solid var(--accent-primary, #3b82f6)' : '1px solid var(--glass-border, #333)',
                cursor: 'pointer',
              }}>
                <div style={{ fontSize: '0.78rem', fontWeight: 500, overflow: 'hidden',
                  textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {doc.doc_type === 'signed-contract' ? '✅ ' : '🖋️ '}{doc.filename}
                </div>
                <div style={{ fontSize: '0.65rem', color: 'var(--text-muted, #666)', marginTop: '0.1rem' }}>
                  {doc.doc_type}{doc.uploaded_at && ` · ${new Date(doc.uploaded_at).toLocaleDateString()}`}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Viewer */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        {!viewDoc ? (
          <div className="empty-state" style={{ padding: '3rem', textAlign: 'center' }}>
            <h3 style={{ fontSize: '0.95rem', margin: '0 0 0.3rem' }}>Select a PDF to sign</h3>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0 }}>
              Detected signature lines get a “Sign here” marker — or click anywhere on a page to place your signature.
            </p>
          </div>
        ) : (
          <>
            {/* Toolbar */}
            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap',
              padding: '0.6rem 1rem', borderBottom: '1px solid var(--glass-border, #333)', flexShrink: 0 }}>
              <div style={{ fontSize: '0.85rem', fontWeight: 600, flex: 1, minWidth: 160,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {viewDoc.filename}
              </div>
              <input value={signName} onChange={e => setSignName(e.target.value)} placeholder="Full name"
                style={inputStyle} />
              <input value={signTitle} onChange={e => setSignTitle(e.target.value)} placeholder="Title (e.g. Managing Member)"
                style={{ ...inputStyle, width: 190 }} />
              <input value={signDate} onChange={e => setSignDate(e.target.value)} placeholder="Date (default: today)"
                style={{ ...inputStyle, width: 150 }} />
              <button onClick={() => setShareModal({ docId: viewDoc.id, filename: viewDoc.filename })}
                className="btn btn-primary" style={{ fontSize: '0.75rem' }}>
                Request signature
              </button>
              <a href={`/api/esign/${viewDoc.id}/download`} target="_blank" rel="noreferrer"
                style={{ fontSize: '0.75rem', color: 'var(--accent-primary, #3b82f6)' }}>Download</a>
            </div>

            {error && (
              <div style={{ padding: '0.5rem 1rem', background: 'rgba(239,68,68,0.12)',
                color: 'var(--accent-coral, #ef4444)', fontSize: '0.8rem', flexShrink: 0 }}>{error}</div>
            )}

            {signedResult && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.5rem 1rem',
                background: 'rgba(34,197,94,0.12)', fontSize: '0.8rem', flexShrink: 0 }}>
                <span>✅ Signed copy saved as <b>{signedResult.filename}</b></span>
                <a href={signedResult.download_url} target="_blank" rel="noreferrer" className="btn btn-primary"
                  style={{ fontSize: '0.75rem', textDecoration: 'none' }}>Download signed PDF</a>
              </div>
            )}

            {/* Pending placement confirm bar */}
            {placement && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.5rem 1rem',
                background: 'var(--bg-surface, #1a1a2e)', borderBottom: '1px solid var(--glass-border, #333)',
                fontSize: '0.8rem', flexShrink: 0 }}>
                <span style={{ fontFamily: "'Segoe Script', 'Brush Script MT', cursive", fontSize: '1.1rem',
                  color: '#8090d0' }}>{signName || 'Your signature'}</span>
                <span style={{ color: 'var(--text-muted, #888)' }}>
                  {placement.block !== undefined
                    ? `→ signature block ${placement.block + 1} (page ${(info?.signature_blocks[placement.block]?.page ?? 0) + 1})`
                    : `→ page ${(placement.page ?? 0) + 1} at clicked position`}
                </span>
                <button onClick={doSign} disabled={signing || !signName.trim()} className="btn btn-primary"
                  style={{ fontSize: '0.78rem' }}>
                  {signing ? 'Signing...' : 'Sign document'}
                </button>
                <button onClick={() => setPlacement(null)} style={{
                  padding: '0.2rem 0.6rem', background: 'var(--bg-elevated, #222)',
                  color: 'var(--text-secondary, #aaa)', borderRadius: 4, fontSize: '0.75rem', cursor: 'pointer' }}>
                  Cancel
                </button>
              </div>
            )}

            {/* Pages */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '1rem', background: 'var(--bg-base, #111)' }}>
              {loadingInfo ? (
                <div style={{ color: 'var(--text-muted, #888)', fontSize: '0.85rem', padding: '2rem', textAlign: 'center' }}>
                  Loading document…
                </div>
              ) : info && (
                <>
                  {(info.page_count <= 30 ? info.pages : info.pages.slice(0, visibleCount)).map(pg => (
                    <div key={pg.index} style={{ position: 'relative', maxWidth: 900, margin: '0 auto 1rem' }}>
                      <img
                        src={`/api/esign/${info.id}/page/${pg.index}`}
                        alt={`Page ${pg.index + 1}`}
                        loading="lazy"
                        decoding="async"
                        onClick={e => handlePageClick(e, pg.index)}
                        style={{ width: '100%', display: 'block', borderRadius: 4, cursor: 'crosshair',
                          boxShadow: '0 2px 12px rgba(0,0,0,0.4)' }}
                      />
                      {blocksForPage(pg.index).map(({ block, index }) => {
                        const sig = block.labels.signature
                        if (!sig) return null
                        if (block.filled) {
                          return (
                            <span key={index} style={{
                              position: 'absolute',
                              left: `${(sig[2] / pg.width) * 100}%`,
                              top: `${(sig[1] / pg.height) * 100}%`,
                              transform: 'translateY(-20%)',
                              padding: '0.15rem 0.5rem',
                              background: 'var(--bg-elevated, #2a2a3e)',
                              color: 'var(--text-muted, #888)', borderRadius: 4, fontSize: '0.7rem', fontWeight: 600,
                              border: '1px solid var(--glass-border, #333)',
                            }}>
                              ✔ Signed
                            </span>
                          )
                        }
                        return (
                          <button key={index}
                            onClick={e => { e.stopPropagation(); setPlacement({ block: index }); setSignedResult(null) }}
                            style={{
                              position: 'absolute',
                              left: `${(sig[2] / pg.width) * 100}%`,
                              top: `${(sig[1] / pg.height) * 100}%`,
                              transform: 'translateY(-20%)',
                              padding: '0.15rem 0.5rem',
                              background: placement?.block === index ? 'var(--accent-primary, #3b82f6)' : 'rgba(59,130,246,0.85)',
                              color: '#fff', borderRadius: 4, fontSize: '0.7rem', fontWeight: 600,
                              cursor: 'pointer', border: 'none',
                            }}>
                            ✍️ Sign here
                          </button>
                        )
                      })}
                      <div style={{ position: 'absolute', bottom: 4, right: 8, fontSize: '0.65rem',
                        color: 'var(--text-muted, #888)' }}>{pg.index + 1} / {info.page_count}</div>
                    </div>
                  ))}
                  {info.page_count > 30 && visibleCount < info.pages.length && (
                    <div style={{ maxWidth: 900, margin: '0 auto 1rem', textAlign: 'center' }}>
                      <button onClick={() => setVisibleCount(c => Math.min(c + 20, info.pages.length))}
                        className="btn btn-primary" style={{ fontSize: '0.8rem' }}>
                        Load {Math.min(20, info.pages.length - visibleCount)} more pages
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          </>
        )}
      </div>

      {shareModal && (
        <RequestSignatureModal
          docId={shareModal.docId}
          filename={shareModal.filename}
          prefillName={shareModal.prefillName}
          prefillEmail={shareModal.prefillEmail}
          onClose={() => setShareModal(null)}
          onCreated={fetchShares}
        />
      )}
    </div>
  )
}

function RequestSignatureModal({ docId, filename, prefillName, prefillEmail, onClose, onCreated }: {
  docId: string
  filename: string
  prefillName?: string
  prefillEmail?: string
  onClose: () => void
  onCreated: () => void
}) {
  const [signers, setSigners] = useState<SignerDraft[]>([{ name: prefillName || '', email: prefillEmail || '' }])
  const [message, setMessage] = useState('')
  const [expiresDays, setExpiresDays] = useState(14)
  const [otpRequired, setOtpRequired] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showUpgradeCta, setShowUpgradeCta] = useState(false)
  const [result, setResult] = useState<{ link: string; emailSent: boolean; signers: ResultSigner[] } | null>(null)
  const [copied, setCopied] = useState(false)

  const setSignerField = (i: number, field: keyof SignerDraft, value: string) =>
    setSigners(list => list.map((sg, idx) => (idx === i ? { ...sg, [field]: value } : sg)))
  const addSigner = () => setSigners(list => (list.length >= 5 ? list : [...list, { name: '', email: '' }]))
  const removeSigner = (i: number) => setSigners(list => list.filter((_, idx) => idx !== i))

  const emailOk = (e: string) => /\S+@\S+\.\S+/.test(e.trim())
  const filledEmails = signers.map(sg => sg.email.trim().toLowerCase()).filter(Boolean)
  const hasDuplicateEmails = new Set(filledEmails).size !== filledEmails.length
  const canSubmit = !submitting && !hasDuplicateEmails
    && signers.every(sg => sg.name.trim().length > 0 && emailOk(sg.email))

  const submit = async () => {
    if (!canSubmit) return
    setSubmitting(true)
    setError(null)
    setShowUpgradeCta(false)
    try {
      const trimmed = signers.map(sg => ({ name: sg.name.trim(), email: sg.email.trim() }))
      const body = trimmed.length > 1
        ? {
            signers: trimmed,
            message: message.trim() || null,
            expiry_days: expiresDays,
            otp_required: otpRequired ? 1 : 0,
          }
        : {
            signer_name: trimmed[0].name,
            signer_email: trimmed[0].email,
            message: message.trim() || null,
            expiry_days: expiresDays,
            otp_required: otpRequired ? 1 : 0,
          }
      const resp = await fetch(`/api/esign/${docId}/share`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await resp.json().catch(() => ({}))
      if (resp.ok) {
        const respSigners: ResultSigner[] = Array.isArray(data.signers)
          ? data.signers
          : trimmed.map((sg, i) => ({ ...sg, order: i + 1, status: i === 0 ? 'pending' : 'waiting' }))
        setResult({
          link: data.link || data.url || '',
          emailSent: data.email_sent !== false,
          signers: respSigners,
        })
        onCreated()
      } else if (resp.status === 403 && data.error === 'entitlement_required') {
        setError(`Sending documents for signature requires the ${data.required_plan} plan or higher (you're on ${data.current_plan}).`)
        setShowUpgradeCta(true)
      } else if (resp.status === 429 && data.error === 'quota_exceeded') {
        setError(`You've used ${data.used} of ${data.quota} signature envelopes this month. Upgrade your plan or purchase an envelope pack to send more.`)
        setShowUpgradeCta(true)
      } else {
        setError(data.detail || `Request failed (${resp.status})`)
      }
    } catch { setError('Request failed (network error)') }
    finally { setSubmitting(false) }
  }

  const copyLink = () => {
    if (!result?.link) return
    navigator.clipboard?.writeText(result.link)
      .then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      })
      .catch(() => {})
  }

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 1000, display: 'flex',
      alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0,0,0,0.55)', padding: '1rem' }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: '100%', maxWidth: 440, padding: '1.1rem 1.2rem',
        background: 'var(--bg-elevated, #1a1a2e)',
        border: '1px solid var(--glass-border, #333)',
        borderRadius: 'var(--radius, 8px)',
        boxShadow: '0 8px 40px rgba(0,0,0,0.5)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '0.2rem' }}>
          <h3 style={{ fontSize: '0.95rem', fontWeight: 700, margin: 0 }}>Request signature</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--text-muted, #888)', fontSize: '1rem', lineHeight: 1, padding: '0 0.2rem' }}>×</button>
        </div>
        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted, #888)', marginBottom: '0.8rem',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={filename}>
          {filename}
        </div>

        {result ? (
          <div>
            <div style={{ fontSize: '0.78rem', marginBottom: '0.4rem' }}>✅ Signature link created.</div>
            {result.signers.length > 1 && (
              <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary, #aaa)', marginBottom: '0.25rem' }}>
                Link for {result.signers[0].name} (signs 1st)
              </div>
            )}
            <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.35rem' }}>
              <input readOnly value={result.link} onFocus={e => e.target.select()}
                style={{ ...modalInputStyle, flex: 1, fontSize: '0.7rem' }} />
              <button onClick={copyLink} className="btn btn-primary" style={{ fontSize: '0.75rem' }}>
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
            <div style={{ fontSize: '0.68rem', color: 'var(--accent-coral, #f59e0b)', marginBottom: '0.5rem' }}>
              This link is shown only once — copy it now if you want to keep it.
            </div>
            {result.emailSent ? (
              <div style={{ fontSize: '0.72rem', color: '#22c55e', marginBottom: '0.7rem' }}>
                Invitation emailed to {result.signers[0]?.email || signers[0].email.trim()}
              </div>
            ) : (
              <div style={{ padding: '0.4rem 0.55rem', background: 'rgba(239,68,68,0.12)', borderRadius: 4,
                fontSize: '0.72rem', color: 'var(--accent-coral, #ef4444)', marginBottom: '0.7rem' }}>
                ⚠ Email failed to send — copy the link and send it yourself.
              </div>
            )}
            {result.signers.length > 1 && (
              <div style={{ marginBottom: '0.7rem' }}>
                <div style={{ fontSize: '0.7rem', fontWeight: 600, marginBottom: '0.25rem' }}>Next signers</div>
                <div style={{ display: 'grid', gap: '0.2rem' }}>
                  {result.signers.slice(1).map(sg => (
                    <div key={sg.order} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem',
                      fontSize: '0.68rem', color: 'var(--text-muted, #888)' }}>
                      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap' }}>{sg.order}. {sg.name} - {sg.email}</span>
                      <span style={{ padding: '0.05rem 0.4rem', borderRadius: 999, fontWeight: 600,
                        fontSize: '0.6rem', background: SHARE_STATUS_STYLES.queued.bg,
                        color: SHARE_STATUS_STYLES.queued.fg }}>queued</span>
                    </div>
                  ))}
                </div>
                <div style={{ fontSize: '0.62rem', color: 'var(--text-muted, #888)', marginTop: '0.25rem' }}>
                  Each signer is emailed their link after the previous signer completes.
                </div>
              </div>
            )}
            <div style={{ textAlign: 'right' }}>
              <button onClick={onClose} className="btn btn-primary" style={{ fontSize: '0.78rem' }}>Done</button>
            </div>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: '0.55rem' }}>
            {error && (
              <div style={{ padding: '0.4rem 0.55rem', background: 'rgba(239,68,68,0.12)', borderRadius: 4,
                fontSize: '0.72rem', color: 'var(--accent-coral, #ef4444)' }}>
                <div>{error}</div>
                {showUpgradeCta && (
                  <div style={{ marginTop: '0.4rem' }}>
                    <a href="/portal/billing" className="btn btn-primary"
                      style={{ fontSize: '0.7rem', textDecoration: 'none' }}>
                      Upgrade plan
                    </a>
                  </div>
                )}
              </div>
            )}
            {signers.map((sg, i) => (
              <div key={i} style={{ display: 'grid', gap: '0.25rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  fontSize: '0.72rem', color: 'var(--text-secondary, #aaa)' }}>
                  <span>Signer {i + 1}{signers.length > 1 ? ` - Signs ${SIGNER_ORDINALS[i] || `${i + 1}th`}` : ''}</span>
                  {signers.length > 1 && (
                    <button onClick={() => removeSigner(i)} title="Remove signer" style={{
                      background: 'none', border: 'none', cursor: 'pointer',
                      color: 'var(--text-muted, #888)', fontSize: '0.9rem', lineHeight: 1, padding: '0 0.2rem' }}>
                      x
                    </button>
                  )}
                </div>
                <div style={{ display: 'flex', gap: '0.4rem' }}>
                  <input value={sg.name} onChange={e => setSignerField(i, 'name', e.target.value)}
                    placeholder="Jane Signer" style={{ ...modalInputStyle, flex: 1, minWidth: 0 }} />
                  <input value={sg.email} onChange={e => setSignerField(i, 'email', e.target.value)} type="email"
                    placeholder="jane@example.com" style={{ ...modalInputStyle, flex: 1, minWidth: 0 }} />
                </div>
              </div>
            ))}
            {hasDuplicateEmails && (
              <div style={{ fontSize: '0.68rem', color: 'var(--accent-coral, #ef4444)' }}>
                Each signer needs a unique email address.
              </div>
            )}
            {signers.length < 5 && (
              <div>
                <button onClick={addSigner} style={{
                  padding: '0.2rem 0.55rem', background: 'var(--bg-surface, #222)',
                  border: '1px solid var(--glass-border, #333)', color: 'var(--text-secondary, #aaa)',
                  borderRadius: 4, fontSize: '0.7rem', cursor: 'pointer' }}>
                  + Add signer
                </button>
              </div>
            )}
            {signers.length > 1 && (
              <div style={{ fontSize: '0.66rem', color: 'var(--text-muted, #888)' }}>
                Signers sign in order; each receives their link after the previous signer completes.
              </div>
            )}
            <label style={modalLabelStyle}>
              Message (optional)
              <textarea value={message} onChange={e => setMessage(e.target.value)} rows={3}
                placeholder="Please sign and return at your earliest convenience."
                style={{ ...modalInputStyle, resize: 'vertical', fontFamily: 'inherit' }} />
            </label>
            <label style={modalLabelStyle}>
              Link expires in
              <select value={expiresDays} onChange={e => setExpiresDays(Number(e.target.value))}
                style={modalInputStyle}>
                <option value={7}>7 days</option>
                <option value={14}>14 days</option>
                <option value={30}>30 days</option>
                <option value={90}>90 days</option>
              </select>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.75rem',
              cursor: 'pointer' }}>
              <input type="checkbox" checked={otpRequired} onChange={e => setOtpRequired(e.target.checked)} />
              Require email verification code
            </label>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.2rem' }}>
              <button onClick={onClose} style={{
                padding: '0.3rem 0.7rem', background: 'var(--bg-surface, #222)',
                border: '1px solid var(--glass-border, #333)', color: 'var(--text-secondary, #aaa)',
                borderRadius: 4, fontSize: '0.75rem', cursor: 'pointer' }}>
                Cancel
              </button>
              <button onClick={submit} disabled={!canSubmit} className="btn btn-primary"
                style={{ fontSize: '0.78rem' }}>
                {submitting ? 'Sending...' : 'Send request'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/** Effective share status for display: pending shares that were opened show as 'viewed'. */
function shareStatus(s: ShareRow): string {
  const eff = s.effective_status || s.status
  return eff === 'pending' && s.viewed_at ? 'viewed' : eff
}

/** Group share rows: rows sharing a non-null envelope_id collapse into one envelope
 *  entry (rows sorted by signer_order); everything else stays a standalone entry. */
function groupShares(shares: ShareRow[]): ShareEntry[] {
  const entries: ShareEntry[] = []
  const seen = new Set<string>()
  for (const s of shares) {
    if (s.envelope_id) {
      if (seen.has(s.envelope_id)) continue
      seen.add(s.envelope_id)
      const rows = shares
        .filter(r => r.envelope_id === s.envelope_id)
        .sort((a, b) => (a.signer_order || 0) - (b.signer_order || 0))
      entries.push({ kind: 'envelope', envelopeId: s.envelope_id, rows })
    } else {
      entries.push({ kind: 'single', share: s })
    }
  }
  return entries
}

/** The final signer's share of a completed envelope (where the sealed document lives),
 *  or null while any other signer is still pending/viewed/waiting. */
function envelopeImportCandidate(rows: ShareRow[]): ShareRow | null {
  if (rows.length === 0) return null
  const final = rows.reduce((a, b) => ((b.signer_order || 0) > (a.signer_order || 0) ? b : a))
  if (shareStatus(final) !== 'signed') return null
  const stillActive = rows.some(r =>
    r.id !== final.id && ['pending', 'viewed', 'waiting'].includes(shareStatus(r)))
  return stillActive ? null : final
}

const SIGNER_ORDINALS = ['1st', '2nd', '3rd', '4th', '5th']

function fmtDate(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString()
}

const SHARE_STATUS_STYLES: Record<string, { bg: string; fg: string }> = {
  pending: { bg: 'rgba(59,130,246,0.15)', fg: '#60a5fa' },
  viewed: { bg: 'rgba(245,158,11,0.15)', fg: '#f59e0b' },
  signed: { bg: 'rgba(34,197,94,0.15)', fg: '#22c55e' },
  revoked: { bg: 'rgba(239,68,68,0.12)', fg: '#ef4444' },
  expired: { bg: 'rgba(148,163,184,0.15)', fg: '#94a3b8' },
  waiting: { bg: 'rgba(148,163,184,0.15)', fg: '#94a3b8' },
  queued: { bg: 'rgba(148,163,184,0.15)', fg: '#94a3b8' },
}

const shareActionStyle: React.CSSProperties = {
  padding: '0.15rem 0.5rem',
  background: 'var(--bg-elevated, #222)',
  border: '1px solid var(--glass-border, #333)',
  color: 'var(--text-secondary, #aaa)',
  borderRadius: 4,
  fontSize: '0.65rem',
  cursor: 'pointer',
}

const modalLabelStyle: React.CSSProperties = {
  display: 'grid',
  gap: '0.25rem',
  fontSize: '0.72rem',
  color: 'var(--text-secondary, #aaa)',
}

const inputStyle: React.CSSProperties = {
  padding: '0.3rem 0.5rem',
  background: 'var(--bg-surface, #1a1a2e)',
  border: '1px solid var(--glass-border, #333)',
  borderRadius: 4,
  color: 'var(--text-primary, #ddd)',
  fontSize: '0.78rem',
  width: 150,
}

const modalInputStyle: React.CSSProperties = {
  padding: '0.35rem 0.5rem',
  background: 'var(--bg-surface, #12121e)',
  border: '1px solid var(--glass-border, #333)',
  borderRadius: 4,
  color: 'var(--text-primary, #ddd)',
  fontSize: '0.78rem',
  width: '100%',
  boxSizing: 'border-box',
}
