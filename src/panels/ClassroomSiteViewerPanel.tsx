'use client'

/**
 * ClassroomSiteViewerPanel — what a class's site holds and where it lives
 * (`/api/v1/academy/classes/{id}/site`, `/lessons`, `/health`). Read-only.
 *
 * Shows the site configuration, the published lessons it serves, and whether a
 * site publisher is wired on this deployment (the public `/health` integrations
 * map) — a saved site on a deployment with no publisher is configured, not live,
 * and the panel says so.
 */

import { useCallback, useEffect, useState } from 'react'
import {
  ACADEMY_API, type AcademyClass, AcademyHttpError, type AcademyLesson, type AcademySite,
  academyFetch, listClasses, seg,
} from './academyApi'

interface Health {
  status?: string
  integrations?: Record<string, string>
}

export interface ClassroomSiteViewerPanelProps {
  apiBase?: string
}

export default function ClassroomSiteViewerPanel({ apiBase = ACADEMY_API }: ClassroomSiteViewerPanelProps) {
  const [classes, setClasses] = useState<AcademyClass[]>([])
  const [selected, setSelected] = useState('')
  const [site, setSite] = useState<AcademySite | null>(null)
  const [noSite, setNoSite] = useState(false)
  const [published, setPublished] = useState<AcademyLesson[]>([])
  const [health, setHealth] = useState<Health | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    listClasses(apiBase)
      .then((cs) => {
        setClasses(cs)
        setSelected((cur) => cur || cs[0]?.id || '')
      })
      .catch((e) => setError((e as Error).message))
    academyFetch<Health>(apiBase, `/health`).then(setHealth).catch(() => setHealth(null))
  }, [apiBase])

  const load = useCallback(async () => {
    if (!selected) return
    setError(null)
    try {
      const d = await academyFetch<{ lessons?: AcademyLesson[] }>(
        apiBase, `/classes/${seg(selected)}/lessons`)
      setPublished((d?.lessons ?? []).filter((l) => l.status === 'published'))
    } catch (e) {
      setError((e as Error).message)
    }
    try {
      setSite(await academyFetch<AcademySite>(apiBase, `/classes/${seg(selected)}/site`))
      setNoSite(false)
    } catch (e) {
      setSite(null)
      if (e instanceof AcademyHttpError && e.status === 404) setNoSite(true)
      else setError((e as Error).message)
    }
  }, [apiBase, selected])

  useEffect(() => { void load() }, [load])

  const publisher = health?.integrations?.site_publisher
  const cls = classes.find((c) => c.id === selected)
  const siteUrl = site?.domain ? `https://${site.domain}` : null

  return (
    <div className="p-4 space-y-4">
      <header className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Classroom Site</h2>
          <p className="text-sm text-gray-500">Where your class site lives and which lessons it serves.</p>
        </div>
        <select value={selected} onChange={(e) => setSelected(e.target.value)}
          className="rounded border px-2 py-1 text-sm" aria-label="Class">
          {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </header>

      {error && <div className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">{error}</div>}
      {publisher && publisher !== 'ok' && (
        <div className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          Site publishing is not available on this deployment ({publisher}); the settings below are
          saved but not deployed.
        </div>
      )}

      {noSite && (
        <p className="text-sm text-gray-500">
          {cls?.name ?? 'This class'} has no classroom site. Set one up in Classroom Publisher.
        </p>
      )}
      {site && (
        <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-gray-500">Status</dt><dd>{site.status}</dd>
          <dt className="text-gray-500">Repository</dt><dd>{site.github_repo ?? '—'}</dd>
          <dt className="text-gray-500">Domain</dt>
          <dd>{siteUrl ? <a href={siteUrl} target="_blank" rel="noopener noreferrer" className="underline">{site.domain}</a> : '—'}</dd>
          <dt className="text-gray-500">Theme</dt><dd>{site.theme ?? 'auto'}</dd>
          <dt className="text-gray-500">Updated</dt>
          <dd>{site.updated_at ? new Date(site.updated_at).toLocaleString() : '—'}</dd>
        </dl>
      )}

      {selected && (
        <section className="text-sm">
          <h3 className="font-medium">Published lessons ({published.length})</h3>
          <ul className="list-disc pl-5">
            {published.map((l) => (
              <li key={l.id}>
                {l.topic}{l.grade_level ? ` (${l.grade_level})` : ''}
                {l.published_at ? ` — ${new Date(l.published_at).toLocaleDateString()}` : ''}
              </li>
            ))}
            {!published.length && <li className="text-gray-500">No published lessons yet.</li>}
          </ul>
        </section>
      )}
    </div>
  )
}
