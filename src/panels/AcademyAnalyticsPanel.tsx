'use client'

/**
 * AcademyAnalyticsPanel — class overview, mastery per standard, engagement and
 * lesson effectiveness by tier, from `GET /api/v1/academy/classes/{id}/analytics`.
 *
 * A metric with no data arrives as `null` and renders as "—", never 0% (0 would
 * read as "every student failed"). A failed call renders as an error.
 */

import { useCallback, useEffect, useState } from 'react'
import { ACADEMY_API, type AcademyClass, academyFetch, listClasses, pct } from './academyApi'
import AcademyClassroomBridge from './AcademyClassroomBridge'

interface ClassAnalytics {
  class_id: string
  overview: {
    total_students: number
    lessons_total: number
    lessons_published: number
    artifacts_generated: number
    challenges: number
  }
  mastery_per_standard: Record<string, number | null>
  engagement: {
    responses_started: number
    responses_submitted: number
    submission_rate: number | null
    students_attempting: number
    average_score: number | null
  }
  content_effectiveness: {
    lesson_id: string
    topic: string
    status: string
    average_score_by_tier: Record<string, number | null>
  }[]
}

export interface AcademyAnalyticsPanelProps {
  apiBase?: string
  /** Preselect a class; otherwise the first class is shown. */
  classId?: string
  /** Where Aither Classroom is on this host (default: academyApi `classroomHref()`). */
  classroomUrl?: string
}

function masteryTone(v: number | null): string {
  if (v === null) return 'bg-gray-100 text-gray-500'
  if (v >= 0.8) return 'bg-emerald-100 text-emerald-800'
  if (v >= 0.6) return 'bg-amber-100 text-amber-800'
  return 'bg-red-100 text-red-800'
}

export default function AcademyAnalyticsPanel({
  apiBase = ACADEMY_API,
  classId,
  classroomUrl,
}: AcademyAnalyticsPanelProps) {
  const [classes, setClasses] = useState<AcademyClass[]>([])
  const [selected, setSelected] = useState<string>(classId || '')
  const [data, setData] = useState<ClassAnalytics | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const loadClasses = useCallback(async () => {
    try {
      const cs = await listClasses(apiBase)
      setClasses(cs)
      setSelected((cur) => cur || cs[0]?.id || '')
      if (!cs.length) setLoading(false)
    } catch (e) {
      setError((e as Error).message)
      setLoading(false)
    }
  }, [apiBase])

  useEffect(() => { void loadClasses() }, [loadClasses])

  const load = useCallback(async () => {
    if (!selected) return
    setLoading(true)
    setError(null)
    try {
      setData(await academyFetch<ClassAnalytics>(
        apiBase, `/classes/${encodeURIComponent(selected)}/analytics`))
    } catch (e) {
      setData(null)
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [apiBase, selected])

  useEffect(() => {
    void load()
  }, [load])

  const o = data?.overview
  const eng = data?.engagement
  const tiers = Array.from(
    new Set((data?.content_effectiveness || []).flatMap((l) => Object.keys(l.average_score_by_tier))),
  ).sort()

  return (
    <div className="p-4 space-y-4">
      <header className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Mastery Analytics</h2>
          <p className="text-sm text-gray-500">Mastery per standard, submission rate and lesson scores by tier, per class.</p>
        </div>
        <div className="flex gap-2">
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            className="rounded border px-2 py-1 text-sm"
            aria-label="Class"
          >
            {classes.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <button type="button" onClick={() => void load()} className="rounded border px-3 py-1 text-sm hover:bg-gray-50">
            Refresh
          </button>
        </div>
      </header>

      {error && (
        <div className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          <strong>Analytics unavailable.</strong> {error}
        </div>
      )}
      {loading && <p className="text-sm text-gray-500">Loading…</p>}
      {/* Where this class lives, and the way to Aither Classroom (a link, never bare words). */}
      <AcademyClassroomBridge apiBase={apiBase} cls={classes.find((c) => c.id === selected)}
        noClasses={!loading && !error && classes.length === 0} onMoved={loadClasses} href={classroomUrl} />

      {o && eng && (
        <>
          <section className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {[
              ['Students', o.total_students],
              ['Lessons', `${o.lessons_published}/${o.lessons_total} published`],
              ['Artifacts', o.artifacts_generated],
              ['Challenges', o.challenges],
              ['Average score', pct(eng.average_score)],
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded border p-3">
                <div className="text-xs text-gray-500">{label}</div>
                <div className="text-lg font-semibold">{value}</div>
              </div>
            ))}
          </section>

          <section>
            <h3 className="mb-2 text-sm font-semibold">Engagement</h3>
            <p className="text-sm text-gray-700">
              {eng.students_attempting} of {o.total_students} students attempted a challenge ·{' '}
              {eng.responses_submitted}/{eng.responses_started} responses submitted (
              {pct(eng.submission_rate)})
            </p>
          </section>

          <section>
            <h3 className="mb-2 text-sm font-semibold">Mastery per standard</h3>
            {Object.keys(data!.mastery_per_standard).length === 0 ? (
              <p className="text-sm text-gray-500">No graded responses yet.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {Object.entries(data!.mastery_per_standard).map(([std, v]) => (
                  <span key={std} className={`rounded px-2 py-1 text-xs font-medium ${masteryTone(v)}`}>
                    {std}: {pct(v)}
                  </span>
                ))}
              </div>
            )}
          </section>

          <section>
            <h3 className="mb-2 text-sm font-semibold">Lesson effectiveness by tier</h3>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500">
                  <th className="py-1">Lesson</th>
                  <th className="py-1">Status</th>
                  {tiers.map((t) => (
                    <th key={t} className="py-1">Tier {t}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {data!.content_effectiveness.map((l) => (
                  <tr key={l.lesson_id}>
                    <td className="py-1">{l.topic}</td>
                    <td className="py-1 text-gray-500">{l.status}</td>
                    {tiers.map((t) => (
                      <td key={t} className="py-1">{pct(l.average_score_by_tier[t] ?? null)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}
    </div>
  )
}
