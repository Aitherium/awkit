'use client'

/**
 * AcademyLessonStudioPanel — classes and lessons (`/api/v1/academy/classes/*`).
 *
 * RETIRED 2026-10-01 (registry.ts RETIRED_PANELS): superseded by Aither Classroom
 * (ClassroomConsolePanel creates the class, ClassroomStudioPanel drafts, tiers and
 * publishes). No registry entry, no render-map key, no index export, no OS app. The
 * module and its package.json export stay so an embedder that imports it by path builds.
 *
 * Create a class, draft a differentiated lesson, approve and publish it. Lesson
 * GENERATION is not triggered from here (the router records `generation:
 * not_started`; artifacts arrive through the pipeline) — the panel shows that
 * state instead of implying content is being written.
 */

import { useCallback, useEffect, useState } from 'react'
import { ACADEMY_API, type AcademyClass, academyFetch, listClasses } from './academyApi'

interface Lesson {
  id: string
  topic: string
  grade_level: string
  duration_minutes: number
  differentiation_strategy: string
  tiers: string[]
  status: string
  generation: string
}

export interface AcademyLessonStudioPanelProps {
  apiBase?: string
}

const GRADES = ['K-2', '3-5', '6-8', '9-12']
const STRATEGIES = ['proficiency_level', 'learning_modality', 'pace', 'interest']

export default function AcademyLessonStudioPanel({ apiBase = ACADEMY_API }: AcademyLessonStudioPanelProps) {
  const [classes, setClasses] = useState<AcademyClass[]>([])
  const [selected, setSelected] = useState('')
  const [lessons, setLessons] = useState<Lesson[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [newClass, setNewClass] = useState({ name: '', grade_level: '6-8', subject: '' })
  const [draft, setDraft] = useState({
    topic: '', grade_level: '6-8', duration_minutes: 45, differentiation_strategy: 'proficiency_level',
  })

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

  const loadClasses = useCallback(
    () => act(async () => {
      const cs = await listClasses(apiBase)
      setClasses(cs)
      setSelected((cur) => cur || cs[0]?.id || '')
    }),
    [apiBase],
  )

  const loadLessons = useCallback(async () => {
    if (!selected) {
      setLessons([])
      return
    }
    await act(async () => {
      const d = await academyFetch<{ lessons?: Lesson[] }>(
        apiBase, `/classes/${encodeURIComponent(selected)}/lessons`)
      setLessons(d?.lessons ?? [])
    })
  }, [apiBase, selected])

  useEffect(() => { void loadClasses() }, [loadClasses])
  useEffect(() => { void loadLessons() }, [loadLessons])

  const createClass = () => act(async () => {
    const c = await academyFetch<AcademyClass>(apiBase, '/classes', {
      method: 'POST',
      body: JSON.stringify({ ...newClass, subject: newClass.subject || null }),
    })
    setNewClass({ name: '', grade_level: '6-8', subject: '' })
    setClasses(await listClasses(apiBase))
    setSelected(c.id)
  })

  const createLesson = () => act(async () => {
    await academyFetch(apiBase, `/classes/${encodeURIComponent(selected)}/lessons`, {
      method: 'POST', body: JSON.stringify(draft),
    })
    setDraft({ ...draft, topic: '' })
    const d = await academyFetch<{ lessons?: Lesson[] }>(
      apiBase, `/classes/${encodeURIComponent(selected)}/lessons`)
    setLessons(d?.lessons ?? [])
  })

  const lessonAction = (l: Lesson, kind: 'approve' | 'publish' | 'discard') => act(async () => {
    const base = `/classes/${encodeURIComponent(selected)}/lessons/${encodeURIComponent(l.id)}`
    if (kind === 'approve') {
      await academyFetch(apiBase, base, { method: 'PATCH', body: JSON.stringify({ status: 'approved' }) })
    } else if (kind === 'publish') {
      await academyFetch(apiBase, `${base}/publish`, { method: 'POST' })
    } else {
      await academyFetch(apiBase, base, { method: 'DELETE' })
    }
    const d = await academyFetch<{ lessons?: Lesson[] }>(
      apiBase, `/classes/${encodeURIComponent(selected)}/lessons`)
    setLessons(d?.lessons ?? [])
  })

  return (
    <div className="p-4 space-y-4">
      <header className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Lesson Studio</h2>
          <p className="text-sm text-gray-500">Classes and differentiated lessons, draft to published.</p>
        </div>
        <select
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          className="rounded border px-2 py-1 text-sm"
          aria-label="Class"
        >
          {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </header>

      {error && <div className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">{error}</div>}

      <section className="flex flex-wrap items-end gap-2 rounded border p-3 text-sm">
        <label>New class
          <input value={newClass.name} onChange={(e) => setNewClass({ ...newClass, name: e.target.value })}
            className="ml-1 rounded border px-2 py-1" placeholder="Biology 6" />
        </label>
        <select value={newClass.grade_level} onChange={(e) => setNewClass({ ...newClass, grade_level: e.target.value })}
          className="rounded border px-2 py-1">
          {GRADES.map((g) => <option key={g}>{g}</option>)}
        </select>
        <input value={newClass.subject} onChange={(e) => setNewClass({ ...newClass, subject: e.target.value })}
          className="rounded border px-2 py-1" placeholder="Subject" />
        <button type="button" disabled={busy || !newClass.name.trim()} onClick={() => void createClass()}
          className="rounded border px-3 py-1 hover:bg-gray-50">Create class</button>
      </section>

      {selected && (
        <section className="flex flex-wrap items-end gap-2 rounded border p-3 text-sm">
          <label>Lesson topic
            <input value={draft.topic} onChange={(e) => setDraft({ ...draft, topic: e.target.value })}
              className="ml-1 rounded border px-2 py-1" placeholder="Photosynthesis" />
          </label>
          <select value={draft.grade_level} onChange={(e) => setDraft({ ...draft, grade_level: e.target.value })}
            className="rounded border px-2 py-1">
            {GRADES.map((g) => <option key={g}>{g}</option>)}
          </select>
          <label>Minutes
            <input type="number" min={15} max={180} value={draft.duration_minutes}
              onChange={(e) => setDraft({ ...draft, duration_minutes: Number(e.target.value) })}
              className="ml-1 w-20 rounded border px-2 py-1" />
          </label>
          <select value={draft.differentiation_strategy}
            onChange={(e) => setDraft({ ...draft, differentiation_strategy: e.target.value })}
            className="rounded border px-2 py-1">
            {STRATEGIES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
          </select>
          <button type="button" disabled={busy || !draft.topic.trim()} onClick={() => void createLesson()}
            className="rounded border px-3 py-1 hover:bg-gray-50">Draft lesson</button>
        </section>
      )}

      {selected && lessons.length === 0 && !busy && !error && (
        <p className="text-sm text-gray-500">No lessons in this class yet.</p>
      )}

      <ul className="divide-y rounded border">
        {lessons.map((l) => (
          <li key={l.id} className="flex items-center justify-between gap-3 p-3 text-sm">
            <div className="min-w-0">
              <div className="truncate font-medium">{l.topic}</div>
              <div className="text-xs text-gray-500">
                {l.grade_level} · {l.duration_minutes} min · tiers {l.tiers.join('/') || '—'} ·
                {' '}generation {l.generation.replace('_', ' ')}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span className="text-xs text-gray-600">{l.status}</span>
              {l.status === 'draft' && (
                <>
                  <button type="button" disabled={busy} onClick={() => void lessonAction(l, 'approve')}
                    className="rounded border px-2 py-0.5 text-xs">Approve</button>
                  <button type="button" disabled={busy} onClick={() => void lessonAction(l, 'discard')}
                    className="rounded border px-2 py-0.5 text-xs text-red-700">Discard</button>
                </>
              )}
              {l.status === 'approved' && (
                <button type="button" disabled={busy} onClick={() => void lessonAction(l, 'publish')}
                  className="rounded border px-2 py-0.5 text-xs">Publish</button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
