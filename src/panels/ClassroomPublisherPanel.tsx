'use client'

/**
 * ClassroomPublisherPanel — "Class Website Publisher": configure and publish a class's static website
 * (an Academy record tool; NOT part of Aither Classroom, whose panels are Classroom{Console,Studio,...})
 * (`/api/v1/academy/classes/{id}/site*`, .PRODUCTS/.ACADEMY/04B).
 *
 * Init or edit the site (GitHub repo `owner/name`, custom domain, theme), request
 * a publish, read the publish log. The router answers publish with 503 while no
 * GitHub Pages publisher is wired on the deployment; the panel shows that reason
 * verbatim instead of implying a deployment happened.
 */

import { useCallback, useEffect, useState } from 'react'
import {
  ACADEMY_API, type AcademyClass, AcademyHttpError, type AcademySite,
  academyFetch, listClasses, seg,
} from './academyApi'

interface LogLine {
  at: string
  line: string
}

type Theme = 'light' | 'dark' | 'auto'

export interface ClassroomPublisherPanelProps {
  apiBase?: string
}

export default function ClassroomPublisherPanel({ apiBase = ACADEMY_API }: ClassroomPublisherPanelProps) {
  const [classes, setClasses] = useState<AcademyClass[]>([])
  const [selected, setSelected] = useState('')
  const [site, setSite] = useState<AcademySite | null>(null)
  const [missing, setMissing] = useState(false)
  const [repo, setRepo] = useState('')
  const [domain, setDomain] = useState('')
  const [theme, setTheme] = useState<Theme>('auto')
  const [logs, setLogs] = useState<LogLine[]>([])
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    listClasses(apiBase)
      .then((cs) => {
        setClasses(cs)
        setSelected((cur) => cur || cs[0]?.id || '')
      })
      .catch((e) => setError((e as Error).message))
  }, [apiBase])

  const loadLogs = useCallback(async () => {
    const d = await academyFetch<{ lines?: LogLine[] }>(apiBase, `/classes/${seg(selected)}/site/logs`)
    setLogs(d?.lines ?? [])
  }, [apiBase, selected])

  const load = useCallback(async () => {
    if (!selected) return
    setError(null)
    setNotice(null)
    try {
      const s = await academyFetch<AcademySite>(apiBase, `/classes/${seg(selected)}/site`)
      setSite(s)
      setMissing(false)
      setRepo(s.github_repo ?? '')
      setDomain(s.domain ?? '')
      setTheme(((s.theme as Theme) || 'auto'))
      await loadLogs()
    } catch (e) {
      setSite(null)
      setLogs([])
      // 404 = this class has no site yet (init it); anything else is a real failure.
      if (e instanceof AcademyHttpError && e.status === 404) setMissing(true)
      else setError((e as Error).message)
    }
  }, [apiBase, selected, loadLogs])

  useEffect(() => { void load() }, [load])

  const config = () => ({ github_repo: repo.trim() || null, domain: domain.trim() || null, theme })

  const initOrSave = async () => {
    setBusy(true)
    setError(null)
    try {
      if (missing) {
        await academyFetch(apiBase, `/classes/${seg(selected)}/site/init`,
          { method: 'POST', body: JSON.stringify(config()) })
      } else {
        await academyFetch(apiBase, `/classes/${seg(selected)}/site`,
          { method: 'PATCH', body: JSON.stringify(config()) })
      }
      await load()
      setNotice(missing ? 'Site initialized' : 'Site settings saved')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const publish = async () => {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await academyFetch(apiBase, `/classes/${seg(selected)}/site/publish`, { method: 'POST' })
      setNotice('Publish requested')
    } catch (e) {
      // 503 = no site publisher on this deployment: say so, never fake a deploy.
      setError(`Publish not performed: ${(e as Error).message}`)
    } finally {
      setBusy(false)
      await loadLogs().catch(() => undefined)
    }
  }

  return (
    <div className="p-4 space-y-4">
      <header className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Class Website Publisher</h2>
          <p className="text-sm text-gray-500">A static site for your class on your own GitHub Pages.</p>
        </div>
        <select value={selected} onChange={(e) => setSelected(e.target.value)}
          className="rounded border px-2 py-1 text-sm" aria-label="Class">
          {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </header>

      {error && <div className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">{error}</div>}
      {notice && <div className="rounded border border-green-300 bg-green-50 p-3 text-sm text-green-800">{notice}</div>}

      {selected && (site || missing) && (
        <section className="grid max-w-md gap-2 rounded border p-3 text-sm">
          {site && <p>Status: <strong>{site.status}</strong></p>}
          {missing && <p className="text-gray-500">This class has no site yet.</p>}
          <label>GitHub repo (owner/name)
            <input value={repo} placeholder="my-school/grade7-science" onChange={(e) => setRepo(e.target.value)}
              className="mt-1 block w-full rounded border px-2 py-1" />
          </label>
          <label>Custom domain
            <input value={domain} placeholder="science.myschool.org" onChange={(e) => setDomain(e.target.value)}
              className="mt-1 block w-full rounded border px-2 py-1" />
          </label>
          <label>Theme{' '}
            <select value={theme} onChange={(e) => setTheme(e.target.value as Theme)}
              className="rounded border px-2 py-1">
              <option value="auto">auto</option>
              <option value="light">light</option>
              <option value="dark">dark</option>
            </select>
          </label>
          <div className="flex gap-2">
            <button type="button" disabled={busy} onClick={() => void initOrSave()}
              className="rounded border px-3 py-1 hover:bg-gray-50">{missing ? 'Initialize site' : 'Save settings'}</button>
            {site && (
              <button type="button" disabled={busy} onClick={() => void publish()}
                className="rounded border px-3 py-1 hover:bg-gray-50">Publish</button>
            )}
          </div>
        </section>
      )}

      {site && (
        <section className="text-sm">
          <h3 className="font-medium">Publish log</h3>
          <pre className="max-h-48 overflow-y-auto rounded border p-2 text-xs">
            {logs.length ? logs.map((l) => `${l.at}  ${l.line}`).join('\n') : 'No log entries yet.'}
          </pre>
        </section>
      )}
    </div>
  )
}
