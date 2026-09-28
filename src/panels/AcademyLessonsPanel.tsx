'use client'

/**
 * AcademyLessonsPanel — the lesson library of a class and each lesson's artifacts
 * (`/api/v1/academy/classes/{id}/lessons*`, `/api/v1/academy/artifacts/*`).
 *
 * Lesson Studio drafts, approves and publishes; this panel is where a teacher
 * FINDS a lesson again (search by topic, filter by status and grade) and hands its
 * artifacts out: download, issue an expiring share link, list and revoke the live
 * ones. A share-link token is a bearer credential the router shows exactly once,
 * so the panel shows it once too and never stores it. The router's PII gate
 * refuses a link for an artifact naming an enrolled student; that refusal is shown.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ACADEMY_API, type AcademyArtifact, type AcademyClass, type AcademyLesson,
  academyFetch, listClasses, seg,
} from './academyApi'

interface ShareLink {
  link_id: string
  created_at?: string
  expires_at: string
}

export interface AcademyLessonsPanelProps {
  apiBase?: string
}

export default function AcademyLessonsPanel({ apiBase = ACADEMY_API }: AcademyLessonsPanelProps) {
  const [classes, setClasses] = useState<AcademyClass[]>([])
  const [selected, setSelected] = useState('')
  const [lessons, setLessons] = useState<AcademyLesson[]>([])
  const [open, setOpen] = useState<AcademyLesson | null>(null)
  const [artifacts, setArtifacts] = useState<AcademyArtifact[]>([])
  const [links, setLinks] = useState<Record<string, ShareLink[]>>({})
  const [issued, setIssued] = useState<{ artifact: string; url: string; expires: string } | null>(null)
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('')
  const [grade, setGrade] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const act = async (fn: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    void act(async () => {
      const cs = await listClasses(apiBase)
      setClasses(cs)
      setSelected((cur) => cur || cs[0]?.id || '')
    })
  }, [apiBase])

  const loadLessons = useCallback(async () => {
    if (!selected) return
    await act(async () => {
      const d = await academyFetch<{ lessons?: AcademyLesson[] }>(
        apiBase, `/classes/${seg(selected)}/lessons`)
      setLessons(d?.lessons ?? [])
      setOpen(null)
      setArtifacts([])
      setIssued(null)
    })
  }, [apiBase, selected])

  useEffect(() => { void loadLessons() }, [loadLessons])

  const openLesson = (l: AcademyLesson) => act(async () => {
    const d = await academyFetch<{ artifacts?: AcademyArtifact[] }>(
      apiBase, `/classes/${seg(selected)}/lessons/${seg(l.id)}/artifacts`)
    setOpen(l)
    setArtifacts(d?.artifacts ?? [])
    setLinks({})
    setIssued(null)
  })

  const fetchLinks = async (a: AcademyArtifact) => {
    const d = await academyFetch<{ share_links?: ShareLink[] }>(
      apiBase, `/artifacts/${seg(a.id)}/share-links`)
    setLinks((cur) => ({ ...cur, [a.id]: d?.share_links ?? [] }))
  }

  const loadLinks = (a: AcademyArtifact) => act(() => fetchLinks(a))

  const share = (a: AcademyArtifact) => act(async () => {
    const r = await academyFetch<{ public_url: string; expires_at: string }>(
      apiBase, `/artifacts/${seg(a.id)}/share-link`,
      { method: 'POST', body: JSON.stringify({ ttl_days: 7 }) })
    setIssued({ artifact: a.id, url: r.public_url, expires: r.expires_at })
    await fetchLinks(a)
  })

  const revoke = (a: AcademyArtifact, link: ShareLink) => act(async () => {
    await academyFetch(apiBase, `/artifacts/${seg(a.id)}/share-links/${seg(link.link_id)}`,
      { method: 'DELETE' })
    if (issued?.artifact === a.id) setIssued(null)
    await fetchLinks(a)
  })

  const shown = useMemo(() => lessons.filter((l) =>
    (!status || l.status === status) &&
    (!grade || l.grade_level === grade) &&
    (!query || l.topic.toLowerCase().includes(query.toLowerCase()))), [lessons, status, grade, query])

  return (
    <div className="p-4 space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Lessons</h2>
          <p className="text-sm text-gray-500">Find a lesson, download its materials, share them by expiring link.</p>
        </div>
        <select value={selected} onChange={(e) => setSelected(e.target.value)}
          className="rounded border px-2 py-1 text-sm" aria-label="Class">
          {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </header>

      {error && <div className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">{error}</div>}

      <div className="flex flex-wrap gap-2 text-sm">
        <input placeholder="Search topic" value={query} onChange={(e) => setQuery(e.target.value)}
          className="rounded border px-2 py-1" aria-label="Search topic" />
        <select value={status} onChange={(e) => setStatus(e.target.value)}
          className="rounded border px-2 py-1" aria-label="Status">
          <option value="">any status</option>
          <option value="draft">draft</option>
          <option value="pending_approval">pending approval</option>
          <option value="approved">approved</option>
          <option value="published">published</option>
        </select>
        <select value={grade} onChange={(e) => setGrade(e.target.value)}
          className="rounded border px-2 py-1" aria-label="Grade">
          <option value="">any grade</option>
          {['K-2', '3-5', '6-8', '9-12'].map((g) => <option key={g} value={g}>{g}</option>)}
        </select>
      </div>

      <ul className="divide-y rounded border">
        {shown.map((l) => (
          <li key={l.id} className="flex items-center justify-between gap-3 p-3 text-sm">
            <div>
              <div className="font-medium">{l.topic}</div>
              <div className="text-xs text-gray-500">
                {l.status} · {l.grade_level || 'grade —'} · tiers {(l.tiers || []).join('/') || '—'}
                {l.created_at ? ` · ${new Date(l.created_at).toLocaleDateString()}` : ''}
              </div>
            </div>
            <button type="button" disabled={busy} onClick={() => void openLesson(l)}
              className="rounded border px-2 py-0.5 text-xs">Artifacts</button>
          </li>
        ))}
        {selected && !shown.length && !busy && (
          <li className="p-3 text-sm text-gray-500">No lessons match.</li>
        )}
      </ul>

      {open && (
        <section className="space-y-2 rounded border p-3 text-sm">
          <h3 className="font-medium">{open.topic} — artifacts</h3>
          {!artifacts.length && <p className="text-gray-500">No artifacts registered for this lesson yet.</p>}
          <ul className="space-y-2">
            {artifacts.map((a) => (
              <li key={a.id}>
                <div className="flex flex-wrap items-center gap-2">
                  <span>{a.tier ? `[${a.tier}] ` : ''}{a.title || a.filename} ({a.kind || 'file'})</span>
                  <a href={`${apiBase}/artifacts/${seg(a.id)}/download`}
                    className="rounded border px-2 py-0.5 text-xs">Download</a>
                  <button type="button" disabled={busy} onClick={() => void share(a)}
                    className="rounded border px-2 py-0.5 text-xs">Share link (7 days)</button>
                  <button type="button" disabled={busy} onClick={() => void loadLinks(a)}
                    className="rounded border px-2 py-0.5 text-xs">Live links</button>
                </div>
                {issued?.artifact === a.id && (
                  <p className="mt-1 break-all text-xs">
                    Copy now, it is not shown again: <code>{issued.url}</code> (expires {issued.expires})
                  </p>
                )}
                {links[a.id] && (
                  <ul className="mt-1 pl-4 text-xs text-gray-700">
                    {links[a.id].map((k) => (
                      <li key={k.link_id} className="flex items-center gap-2">
                        {k.link_id} · expires {k.expires_at}
                        <button type="button" disabled={busy} onClick={() => void revoke(a, k)}
                          className="rounded border px-1 text-red-700">Revoke</button>
                      </li>
                    ))}
                    {!links[a.id].length && <li>No live share links.</li>}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
