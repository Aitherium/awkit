'use client'

/**
 * A person's comments and resume, under the staff detail in PeoplePanel.
 *
 * Customer review, 2026-10-27: "There is no comments on people", and "upload resumes".
 * Comments follow the task-comment shape (author, body, time) and live at
 * `{apiBase}/staff/{id}/comments`. A resume is uploaded through the documents
 * door like any file, then linked to the person (`PUT {apiBase}/staff/{id}/resume`).
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'

export interface StaffComment {
  id: string
  author: string
  body: string
  created_at: string | null
}

export interface PeopleStaffNotesProps {
  apiBase: string
  documentsBase?: string
  staffId: string
  resumeDocId: string | null
  onResumeLinked?: (docId: string | null) => void
}

const label: CSSProperties = { color: 'var(--text-muted, #888)', fontSize: '0.75rem', marginBottom: 6 }
const smallBtn: CSSProperties = {
  padding: '0.3rem 0.7rem', borderRadius: 6, fontSize: '0.75rem', cursor: 'pointer',
  background: 'var(--bg-elevated, #333)', color: 'var(--text-primary, #eee)',
  border: '1px solid var(--border, #333)',
}

async function refusalText(r: Response, fallback: string): Promise<string> {
  try {
    const d = await r.json()
    return typeof d?.detail === 'string' ? d.detail : fallback
  } catch { return fallback }
}

function when(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
}

export default function PeopleStaffNotes({
  apiBase, documentsBase = '/api/documents', staffId, resumeDocId, onResumeLinked,
}: PeopleStaffNotesProps) {
  const [comments, setComments] = useState<StaffComment[]>([])
  const [draft, setDraft] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [resumeNote, setResumeNote] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const base = `${apiBase}/staff/${encodeURIComponent(staffId)}`

  const load = useCallback(async () => {
    try {
      const r = await fetch(`${base}/comments`)
      if (r.ok) {
        const d = await r.json()
        setComments(Array.isArray(d?.comments) ? d.comments : [])
      }
    } catch { /* the list stays as it was */ }
  }, [base])

  useEffect(() => { load() }, [load])

  const post = async () => {
    const body = draft.trim()
    if (!body || busy) return
    setBusy(true)
    setError('')
    try {
      const r = await fetch(`${base}/comments`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body }),
      })
      if (!r.ok) { setError(await refusalText(r, 'The comment could not be saved.')); return }
      const d = await r.json()
      if (d?.comment) setComments(prev => [...prev, d.comment])
      setDraft('')
    } catch {
      setError('The comment could not be saved: the workspace did not answer.')
    } finally { setBusy(false) }
  }

  const remove = async (id: string) => {
    setError('')
    try {
      const r = await fetch(`${base}/comments/${encodeURIComponent(id)}`, { method: 'DELETE' })
      if (!r.ok) { setError(await refusalText(r, 'The comment could not be removed.')); return }
      setComments(prev => prev.filter(c => c.id !== id))
    } catch { setError('The comment could not be removed: the workspace did not answer.') }
  }

  const link = async (docId: string | null) => {
    const r = await fetch(`${base}/resume`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ doc_id: docId }),
    })
    if (!r.ok) throw new Error(await refusalText(r, 'The resume could not be attached.'))
    onResumeLinked?.(docId)
  }

  const uploadResume = async (file: File) => {
    setError('')
    setResumeNote(`Uploading ${file.name}...`)
    try {
      const form = new FormData()
      form.append('file', file)
      form.append('doc_type', 'resume')
      form.append('auto_extract', 'false')
      form.append('on_duplicate', 'keep_both')
      form.append('project', 'Resumes')
      const r = await fetch(`${documentsBase}/upload`, { method: 'POST', body: form })
      if (!r.ok) { setResumeNote(''); setError(await refusalText(r, 'The resume could not be uploaded.')); return }
      const d = await r.json().catch(() => ({}))
      if (!d?.doc_id) {
        setResumeNote(`${file.name} is being read in the background. Attach it here once it shows in Documents.`)
        return
      }
      await link(d.doc_id)
      setResumeNote(`${file.name} attached.`)
    } catch (e) {
      setResumeNote('')
      setError(e instanceof Error && e.message ? e.message : 'The resume could not be uploaded.')
    }
  }

  return (
    <div data-testid="people-staff-notes" style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <div style={label}>Resume</div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          {resumeDocId ? (
            <>
              <a href={`${documentsBase}/${encodeURIComponent(resumeDocId)}/download`}
                style={{ color: 'var(--accent-primary, #d97706)', fontSize: '0.8rem', textDecoration: 'none' }}>
                Open resume
              </a>
              <button style={smallBtn} onClick={() => fileRef.current?.click()}>Replace</button>
              <button style={smallBtn} onClick={() => { link(null).catch(e => setError(String(e?.message || e))) }}>Detach</button>
            </>
          ) : (
            <button style={smallBtn} onClick={() => fileRef.current?.click()}>Upload resume</button>
          )}
          <input ref={fileRef} type="file" hidden aria-label="Resume file"
            accept=".pdf,.doc,.docx,.txt,.rtf"
            onChange={e => { const f = e.target.files?.[0]; if (f) uploadResume(f); e.target.value = '' }} />
        </div>
        {resumeNote && <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary, #aaa)', marginTop: 6 }}>{resumeNote}</div>}
      </div>

      <div>
        <div style={label}>Comments{comments.length ? ` (${comments.length})` : ''}</div>
        {comments.length === 0 && (
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted, #888)', marginBottom: 8 }}>No comments yet.</div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 8 }}>
          {comments.map(c => (
            <div key={c.id} data-testid="people-staff-comment" style={{
              padding: '0.5rem 0.65rem', borderRadius: 6, background: 'var(--bg-elevated, #333)', fontSize: '0.8rem',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
                <span style={{ fontWeight: 600 }}>{c.author || 'someone'}</span>
                <span style={{ color: 'var(--text-muted, #888)', fontSize: '0.7rem' }}>{when(c.created_at)}</span>
              </div>
              <div style={{ whiteSpace: 'pre-wrap' }}>{c.body}</div>
              <button onClick={() => remove(c.id)} aria-label="Delete comment" style={{
                background: 'transparent', border: 'none', color: 'var(--text-muted, #888)',
                fontSize: '0.7rem', cursor: 'pointer', padding: 0, marginTop: 4,
              }}>Delete</button>
            </div>
          ))}
        </div>
        <textarea value={draft} onChange={e => setDraft(e.target.value)} rows={2}
          aria-label="New comment"
          placeholder="Add a comment about this person..."
          onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) post() }}
          style={{
            width: '100%', padding: '0.5rem 0.65rem', borderRadius: 6, fontSize: '0.8rem', resize: 'vertical',
            background: 'var(--bg-deep, #111)', color: 'var(--text-primary, #eee)',
            border: '1px solid var(--border, #333)', boxSizing: 'border-box',
          }} />
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 6 }}>
          <button onClick={post} disabled={!draft.trim() || busy} style={{
            ...smallBtn, background: 'var(--accent-primary, #d97706)', color: 'var(--bg-deep, #111)',
            border: 'none', fontWeight: 600, opacity: draft.trim() && !busy ? 1 : 0.5,
          }}>Comment</button>
        </div>
        {error && (
          <div role="alert" style={{
            marginTop: 8, padding: '0.5rem 0.75rem', borderRadius: 6, fontSize: '0.8rem',
            background: 'rgba(239, 68, 68, 0.12)', color: '#ef4444',
          }}>{error}</div>
        )}
      </div>
    </div>
  )
}
