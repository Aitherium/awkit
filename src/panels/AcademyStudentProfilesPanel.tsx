'use client'

/**
 * AcademyStudentProfilesPanel — student profiles and progress per class
 * (`/api/v1/academy/classes/{id}/students*`).
 *
 * Names are first name or alias only (the router caps them at 40 characters);
 * the panel refuses a surname or an email before anything is sent (aliasProblem).
 * Rosters arrive as a pasted CSV (`name, tier, accommodations`) through the
 * router's all-or-nothing `students/bulk`. Edits carry `profile_version`, the
 * optimistic lock the router enforces (409 on a stale edit). Progress is read
 * from the router's graded responses, never computed here.
 */

import { useCallback, useEffect, useState } from 'react'
import {
  ACADEMY_API, type AcademyClass, academyFetch, aliasProblem, listClasses, parseStudentCsv, pct,
} from './academyApi'

interface Student {
  student_id: string
  name: string
  proficiency_level?: string | null
  learning_modality?: string | null
  accommodations: string[]
  interests: string[]
  profile_version: number
}

interface Progress {
  graded_responses: number
  mastery_per_standard: Record<string, number>
  tier_completion: Record<string, number>
}

export interface AcademyStudentProfilesPanelProps {
  apiBase?: string
}

export default function AcademyStudentProfilesPanel({ apiBase = ACADEMY_API }: AcademyStudentProfilesPanelProps) {
  const [classes, setClasses] = useState<AcademyClass[]>([])
  const [selected, setSelected] = useState('')
  const [students, setStudents] = useState<Student[]>([])
  const [progress, setProgress] = useState<Record<string, Progress>>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState({ name: '', proficiency_level: '', learning_modality: '' })
  const [csv, setCsv] = useState('')
  const [csvErrors, setCsvErrors] = useState<string[]>([])
  const [editing, setEditing] = useState<Student | null>(null)

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

  const loadStudents = useCallback(async () => {
    if (!selected) return
    await act(async () => {
      const d = await academyFetch<{ students?: Student[] }>(
        apiBase, `/classes/${encodeURIComponent(selected)}/students`)
      setStudents(d?.students ?? [])
      setProgress({})
    })
  }, [apiBase, selected])

  useEffect(() => { void loadStudents() }, [loadStudents])

  const enroll = () => act(async () => {
    const problem = aliasProblem(form.name)
    if (problem) throw new Error(problem)
    await academyFetch(apiBase, `/classes/${encodeURIComponent(selected)}/students`, {
      method: 'POST',
      body: JSON.stringify({
        name: form.name.trim(),
        proficiency_level: form.proficiency_level || null,
        learning_modality: form.learning_modality || null,
      }),
    })
    setForm({ name: '', proficiency_level: '', learning_modality: '' })
    await loadStudents()
  })

  const importCsv = () => act(async () => {
    const { rows, errors } = parseStudentCsv(csv)
    setCsvErrors(errors)
    // All-or-nothing, like the router: a roster with a bad row is not half-sent.
    if (errors.length || !rows.length) return
    await academyFetch(apiBase, `/classes/${encodeURIComponent(selected)}/students/bulk`, {
      method: 'POST',
      body: JSON.stringify({ students: rows }),
    })
    setCsv('')
    await loadStudents()
  })

  const saveEdit = () => act(async () => {
    if (!editing) return
    const problem = aliasProblem(editing.name)
    if (problem) throw new Error(problem)
    await academyFetch(apiBase,
      `/classes/${encodeURIComponent(selected)}/students/${encodeURIComponent(editing.student_id)}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: editing.name.trim(),
          proficiency_level: editing.proficiency_level || null,
          learning_modality: editing.learning_modality || null,
          profile_version: editing.profile_version,
        }),
      })
    setEditing(null)
    await loadStudents()
  })

  const remove = (s: Student) => act(async () => {
    await academyFetch(apiBase,
      `/classes/${encodeURIComponent(selected)}/students/${encodeURIComponent(s.student_id)}`,
      { method: 'DELETE' })
    await loadStudents()
  })

  const showProgress = (s: Student) => act(async () => {
    const p = await academyFetch<Progress>(apiBase,
      `/classes/${encodeURIComponent(selected)}/students/${encodeURIComponent(s.student_id)}/progress`)
    setProgress((cur) => ({ ...cur, [s.student_id]: p }))
  })

  return (
    <div className="p-4 space-y-4">
      <header className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Student Profiles</h2>
          <p className="text-sm text-gray-500">Who is in each class, how they learn, and how they are doing.</p>
        </div>
        <select value={selected} onChange={(e) => setSelected(e.target.value)}
          className="rounded border px-2 py-1 text-sm" aria-label="Class">
          {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </header>

      {error && <div className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">{error}</div>}

      {selected && (
        <section className="flex flex-wrap items-end gap-2 rounded border p-3 text-sm">
          <label>Student (first name or alias only)
            <input value={form.name} maxLength={40} onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="ml-1 rounded border px-2 py-1" />
          </label>
          <select value={form.proficiency_level} onChange={(e) => setForm({ ...form, proficiency_level: e.target.value })}
            className="rounded border px-2 py-1" aria-label="Proficiency">
            <option value="">proficiency —</option>
            <option value="below">below</option>
            <option value="at">at</option>
            <option value="above">above</option>
          </select>
          <select value={form.learning_modality} onChange={(e) => setForm({ ...form, learning_modality: e.target.value })}
            className="rounded border px-2 py-1" aria-label="Modality">
            <option value="">modality —</option>
            <option value="visual">visual</option>
            <option value="auditory">auditory</option>
            <option value="kinesthetic">kinesthetic</option>
            <option value="mixed">mixed</option>
          </select>
          <button type="button" disabled={busy || !form.name.trim()} onClick={() => void enroll()}
            className="rounded border px-3 py-1 hover:bg-gray-50">Enroll</button>
        </section>
      )}

      {selected && (
        <section className="space-y-2 rounded border p-3 text-sm">
          <label className="block">Import roster (CSV: name, tier A/B/C, accommodations separated by ;)
            <textarea value={csv} onChange={(e) => setCsv(e.target.value)} rows={4}
              placeholder={'name,tier,accommodations\nMaya,A,extra time;large print\nJo,C,'}
              className="mt-1 block w-full rounded border px-2 py-1 font-mono text-xs" />
          </label>
          <button type="button" disabled={busy || !csv.trim()} onClick={() => void importCsv()}
            className="rounded border px-3 py-1 hover:bg-gray-50">Import</button>
          {csvErrors.length > 0 && (
            <ul className="list-disc pl-5 text-xs text-red-700">
              {csvErrors.map((e) => <li key={e}>{e}</li>)}
            </ul>
          )}
        </section>
      )}

      {selected && students.length === 0 && !busy && !error && (
        <p className="text-sm text-gray-500">No students enrolled in this class.</p>
      )}

      <ul className="divide-y rounded border">
        {students.map((s) => {
          const p = progress[s.student_id]
          return (
            <li key={s.student_id} className="p-3 text-sm">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="font-medium">{s.name}</div>
                  <div className="text-xs text-gray-500">
                    {s.proficiency_level || 'proficiency —'} · {s.learning_modality || 'modality —'}
                    {s.accommodations.length ? ` · ${s.accommodations.join(', ')}` : ''}
                    {s.interests.length ? ` · likes ${s.interests.join(', ')}` : ''}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button type="button" disabled={busy} onClick={() => void showProgress(s)}
                    className="rounded border px-2 py-0.5 text-xs">Progress</button>
                  <button type="button" disabled={busy} onClick={() => setEditing({ ...s })}
                    className="rounded border px-2 py-0.5 text-xs">Edit</button>
                  <button type="button" disabled={busy} onClick={() => void remove(s)}
                    className="rounded border px-2 py-0.5 text-xs text-red-700">Remove</button>
                </div>
              </div>
              {editing?.student_id === s.student_id && (
                <div className="mt-2 flex flex-wrap items-end gap-2 text-xs">
                  <input value={editing.name} maxLength={40} aria-label="Alias"
                    onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                    className="rounded border px-2 py-1" />
                  <select value={editing.proficiency_level || ''} aria-label="Edit proficiency"
                    onChange={(e) => setEditing({ ...editing, proficiency_level: e.target.value })}
                    className="rounded border px-2 py-1">
                    <option value="">proficiency —</option>
                    <option value="below">below</option>
                    <option value="at">at</option>
                    <option value="above">above</option>
                  </select>
                  <select value={editing.learning_modality || ''} aria-label="Edit modality"
                    onChange={(e) => setEditing({ ...editing, learning_modality: e.target.value })}
                    className="rounded border px-2 py-1">
                    <option value="">modality —</option>
                    <option value="visual">visual</option>
                    <option value="auditory">auditory</option>
                    <option value="kinesthetic">kinesthetic</option>
                    <option value="mixed">mixed</option>
                  </select>
                  <button type="button" disabled={busy} onClick={() => void saveEdit()}
                    className="rounded border px-2 py-0.5">Save</button>
                  <button type="button" onClick={() => setEditing(null)}
                    className="rounded border px-2 py-0.5">Cancel</button>
                </div>
              )}
              {p && (
                <div className="mt-2 text-xs text-gray-700">
                  {p.graded_responses} graded ·{' '}
                  {Object.entries(p.mastery_per_standard).map(([k, v]) => `${k} ${pct(v)}`).join(' · ') ||
                    'no graded work yet'}
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
