'use client'

import { useState, useCallback, useRef, useEffect } from 'react'

interface UserInfo {
  display_name: string
  [key: string]: unknown
}

export interface OnboardingWizardPanelProps {
  apiBase?: string
  user: UserInfo
  onComplete: () => void
}

type Step = 'setup' | 'done'

interface UploadFailure { name: string; reason: string }

/**
 * First-run setup.
 *
 * The previous version was four full-screen steps — welcome, upload, Obsidian,
 * done — that a user had to click through every time, and it asked an EMPTY
 * question: it never looked at whether the workspace already had content. On a
 * seeded deployment (one tenant ships with 14 staff, 19 projects and 66 indexed
 * vectors) it still opened on "Let's set up your knowledge base" over an empty
 * dropzone, and "You're all set!" appeared whether or not anything was set up.
 *
 * Three changes, in order of how much they matter:
 *   1. It ASKS FIRST. If the workspace already has documents or staff there is
 *      nothing to set up, so the wizard completes itself and the user lands in
 *      the app. Setup screens for a workspace that is already set up are the
 *      whole complaint.
 *   2. Two steps, not four. Obsidian was never worth a step of its own — most
 *      users have no vault — so it is an optional disclosure under the upload,
 *      and the welcome text lives above the thing it is describing.
 *   3. Skip is always visible. Previously the only way out was to press Next
 *      through screens that did nothing, which reads as "this is mandatory".
 *
 * It also stops lying about failures: the old handler had `catch { }` around
 * each upload and pushed only successes, so uploading three files that all
 * 500'd showed nothing at all — no error, no count, no clue.
 */
export default function OnboardingWizardPanel({ apiBase = '/api', user, onComplete }: OnboardingWizardPanelProps) {
  const [step, setStep] = useState<Step>('setup')
  const [probing, setProbing] = useState(true)
  const [uploadedFiles, setUploadedFiles] = useState<string[]>([])
  const [failures, setFailures] = useState<UploadFailure[]>([])
  const [uploading, setUploading] = useState(false)
  const [showObsidian, setShowObsidian] = useState(false)
  const [vaultPath, setVaultPath] = useState('')
  const [syncing, setSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState<{ ok: boolean; msg: string } | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  // ── 1. Ask whether setup is needed at all ────────────────────────────────
  // A 404/500/offline probe must NOT trap the user in a wizard, so any failure
  // falls through to showing it — the safe direction is "offer setup", never
  // "silently skip setup the user needed".
  useEffect(() => {
    let cancelled = false
    const probe = async () => {
      try {
        const [docsRes, staffRes] = await Promise.all([
          fetch(`${apiBase}/documents`, { credentials: 'include' }).catch(() => null),
          fetch(`${apiBase}/people/stats`, { credentials: 'include' }).catch(() => null),
        ])
        let docs = 0
        let staff = 0
        if (docsRes?.ok) {
          const d = await docsRes.json().catch(() => null)
          docs = Array.isArray(d) ? d.length : Number(d?.total ?? 0)
        }
        if (staffRes?.ok) {
          const s = await staffRes.json().catch(() => null)
          staff = Number(s?.company_staff ?? 0)
        }
        if (!cancelled && (docs > 0 || staff > 0)) {
          onComplete()
          return
        }
      } catch {
        /* fall through to showing the wizard */
      }
      if (!cancelled) setProbing(false)
    }
    probe()
    return () => { cancelled = true }
  }, [apiBase, onComplete])

  const handleFiles = useCallback(async (files: FileList | File[]) => {
    setUploading(true)
    const ok: string[] = []
    const bad: UploadFailure[] = []
    for (const file of Array.from(files)) {
      const form = new FormData()
      form.append('file', file)
      try {
        const res = await fetch(`${apiBase}/documents/upload`, {
          method: 'POST', body: form, credentials: 'include',
        })
        if (res.ok) ok.push(file.name)
        else bad.push({ name: file.name, reason: `server said ${res.status}` })
      } catch (e) {
        bad.push({ name: file.name, reason: e instanceof Error ? e.message : 'upload failed' })
      }
    }
    setUploadedFiles(prev => [...prev, ...ok])
    setFailures(prev => [...prev, ...bad])
    setUploading(false)
  }, [apiBase])

  const handleSync = async () => {
    if (!vaultPath.trim()) return
    setSyncing(true)
    setSyncResult(null)
    try {
      const res = await fetch(`${apiBase}/obsidian/sync`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ vault_path: vaultPath }),
      })
      if (res.ok) {
        const d = await res.json()
        setSyncResult({ ok: true, msg: `Synced ${d.total_files ?? 0} file(s)` })
      } else {
        setSyncResult({ ok: false, msg: `Sync failed (${res.status}). Check the vault path.` })
      }
    } catch {
      setSyncResult({ ok: false, msg: 'Sync failed — the server was unreachable.' })
    } finally {
      setSyncing(false)
    }
  }

  // Nothing rendered while we decide — a flash of "set up your knowledge base"
  // on a workspace that is already set up is the exact jarring moment this fixes.
  if (probing) return null

  const btn = (primary: boolean): React.CSSProperties => ({
    padding: primary ? '0.85rem 1.6rem' : '0.7rem 1.2rem',
    background: primary ? 'var(--accent-primary)' : 'transparent',
    color: primary ? 'var(--bg-deep)' : 'var(--text-secondary)',
    borderRadius: 'var(--radius)',
    fontSize: '0.9rem',
    fontWeight: primary ? 600 : 500,
    border: primary ? 'none' : '1px solid var(--glass-border)',
    cursor: 'pointer',
  })

  const nothingAdded = uploadedFiles.length === 0 && !syncResult?.ok

  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        minHeight: '100vh', background: 'var(--bg-deep)', padding: '2rem',
      }}
      onKeyDown={e => {
        if (e.key === 'Enter' && step === 'setup' && !uploading) setStep('done')
        if (e.key === 'Escape' && step === 'setup') onComplete()
      }}
    >
      <div style={{
        width: '100%', maxWidth: 560, background: 'var(--bg-surface)',
        border: '1px solid var(--glass-border)', borderRadius: 'var(--radius-lg)', padding: '2.5rem',
      }}>
        {step === 'setup' && (
          <>
            <h2 style={{ fontSize: '1.4rem', fontWeight: 700, marginBottom: '0.5rem' }}>
              Welcome, {user.display_name}
            </h2>
            <p style={{ color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: '1.75rem' }}>
              Add a few documents and the assistant can answer from them straight away —
              resumes, proposals, project sheets, anything you would otherwise go digging for.
            </p>

            <div
              onDrop={e => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files) }}
              onDragOver={e => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onClick={() => fileRef.current?.click()}
              role="button"
              tabIndex={0}
              aria-label="Upload documents"
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') fileRef.current?.click() }}
              style={{
                border: `2px dashed ${dragOver ? 'var(--accent-primary)' : 'var(--glass-border)'}`,
                borderRadius: 'var(--radius)', padding: '2.5rem 1.5rem', textAlign: 'center',
                cursor: 'pointer', background: dragOver ? 'var(--bg-elevated)' : 'transparent',
              }}
            >
              <p style={{ color: 'var(--text-secondary)' }}>
                {uploading ? 'Uploading…' : 'Drag & drop files here, or click to browse'}
              </p>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginTop: '0.5rem' }}>
                PDF, TXT, MD, DOCX, XLSX
              </p>
            </div>
            <input ref={fileRef} type="file" multiple hidden
              onChange={e => e.target.files && handleFiles(e.target.files)} />

            {uploadedFiles.length > 0 && (
              <p style={{ fontSize: '0.8rem', color: 'var(--accent-green)', marginTop: '1rem' }}>
                {uploadedFiles.length} file(s) added
              </p>
            )}
            {/* Failures are SHOWN. The old version swallowed them entirely. */}
            {failures.length > 0 && (
              <div style={{ marginTop: '0.75rem' }}>
                {failures.slice(0, 3).map(f => (
                  <p key={f.name} style={{ fontSize: '0.8rem', color: 'var(--accent-coral)' }}>
                    {f.name} — {f.reason}
                  </p>
                ))}
                {failures.length > 3 && (
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    …and {failures.length - 3} more
                  </p>
                )}
              </div>
            )}

            {/* Obsidian: an option, not a step. */}
            <button
              onClick={() => setShowObsidian(v => !v)}
              style={{
                marginTop: '1.5rem', background: 'none', border: 'none', padding: 0,
                color: 'var(--text-muted)', fontSize: '0.8rem', cursor: 'pointer',
              }}
            >
              {showObsidian ? '− ' : '+ '}Sync an Obsidian vault instead
            </button>
            {showObsidian && (
              <div style={{ marginTop: '0.75rem' }}>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <input
                    type="text" value={vaultPath} onChange={e => setVaultPath(e.target.value)}
                    placeholder="/path/to/obsidian/vault"
                    style={{
                      flex: 1, padding: '0.7rem 1rem', background: 'var(--bg-elevated)',
                      color: 'var(--text-primary)', borderRadius: 'var(--radius)',
                      border: '1px solid var(--glass-border)', fontSize: '0.85rem',
                    }}
                  />
                  <button onClick={handleSync} disabled={syncing || !vaultPath.trim()}
                    style={{ ...btn(true), padding: '0.7rem 1.2rem', fontSize: '0.85rem',
                      opacity: syncing || !vaultPath.trim() ? 0.5 : 1 }}>
                    {syncing ? 'Syncing…' : 'Sync'}
                  </button>
                </div>
                {syncResult && (
                  <p style={{ fontSize: '0.8rem', marginTop: '0.5rem',
                    color: syncResult.ok ? 'var(--accent-green)' : 'var(--accent-coral)' }}>
                    {syncResult.msg}
                  </p>
                )}
              </div>
            )}

            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              marginTop: '2rem', paddingTop: '1.5rem', borderTop: '1px solid var(--glass-border)',
            }}>
              {/* Always available. Never trap the user in setup. */}
              <button onClick={onComplete} style={btn(false)}>Skip for now</button>
              <button onClick={() => setStep('done')} disabled={uploading} style={{
                ...btn(true), opacity: uploading ? 0.6 : 1,
              }}>
                {nothingAdded ? 'Continue' : 'Done'}
              </button>
            </div>
          </>
        )}

        {step === 'done' && (
          <div style={{ textAlign: 'center' }}>
            <h2 style={{ fontSize: '1.4rem', fontWeight: 700, marginBottom: '0.75rem' }}>
              {nothingAdded ? 'Ready when you are' : "You're all set"}
            </h2>
            {/* Honest: the old copy said "You're all set!" even when nothing was added. */}
            <p style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>
              {uploadedFiles.length > 0 && `${uploadedFiles.length} document(s) ingested. `}
              {syncResult?.ok && `${syncResult.msg}. `}
              {nothingAdded
                ? 'You can add documents any time from the Knowledge tab — the assistant works without them too.'
                : 'The assistant can answer from them now.'}
            </p>
            <button onClick={onComplete} style={{ ...btn(true), width: '100%', marginTop: '2rem' }}>
              Start Chatting
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
