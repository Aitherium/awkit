/**
 * GitHubReposPanel — the workspace's connected org: repos, issues, and the
 * agents that can take them.
 *
 * Three things share this surface, none of them built here:
 *   - repos + issues come from /api/github (which proxies AitherFlow's GitHub App)
 *   - ForgeIDE opens the repo in an editor + live terminal where Demiurge
 *     already shares the workspace
 *   - an issue can be handed to Demiurge (code), Atlas (planning), Saga, Lyra
 *     or Chaos through the same bridge github_assign_issue_to_agent uses
 *
 * THIS PANEL HAS NO DEFAULT DATA, deliberately. The DGG panel it replaces
 * shipped a hardcoded DEFAULT_PROJECTS list whose four repo URLs all 404'd, and
 * it reached the screen by three paths: initial state, a `|| DEFAULT` fallback
 * on an empty response, and "keep showing old data on error". Its backend did
 * not exist, so the error path was the normal path — a confident dashboard of
 * repositories that were not the customer's.
 *
 * So: empty until the API answers, and an error renders as an error. "No repos"
 * and "not connected" are shown as DIFFERENT states, because the API
 * distinguishes them and collapsing that is what makes a broken credential look
 * like an empty org.
 *
 * `default_branch` is displayed per repo because it is not uniform inside one
 * org — on the first org wired to this, four repos default to `main` and three
 * to `dev`. Anything that branches or opens a PR must read it per repo.
 */
import React, { useCallback, useEffect, useState } from 'react'

export interface GitHubReposPanelProps {
  apiBase?: string
  autoRefresh?: boolean
  refreshIntervalMs?: number
}

interface Repo {
  name: string
  full_name: string
  html_url: string
  description: string | null
  default_branch: string
  open_issues_count: number
  private: boolean
  language: string | null
  pushed_at: string | null
  forge_url?: string
}

interface Agent {
  name: string
  role: string
}

interface Issue {
  number: number
  title: string
  html_url?: string
  state?: string
  labels?: unknown[]
}

type Conn =
  | { kind: 'loading' }
  | { kind: 'unbound' }
  | { kind: 'error'; detail: string }
  | { kind: 'ok'; org: string; authMode?: string }

export default function GitHubReposPanel({
  apiBase = '/api/github',
  autoRefresh = true,
  refreshIntervalMs = 120000,
}: GitHubReposPanelProps) {
  const [conn, setConn] = useState<Conn>({ kind: 'loading' })
  const [repos, setRepos] = useState<Repo[]>([])
  const [agents, setAgents] = useState<Agent[]>([])
  const [openRepo, setOpenRepo] = useState<string | null>(null)
  const [issues, setIssues] = useState<Issue[]>([])
  const [issuesError, setIssuesError] = useState<string | null>(null)
  const [writesEnabled, setWritesEnabled] = useState(false)
  const [forgeUrl, setForgeUrl] = useState<string>('')

  const load = useCallback(async () => {
    try {
      const r = await fetch(`${apiBase}/repos`, { credentials: 'include' })
      if (!r.ok) {
        setConn({ kind: 'error', detail: `HTTP ${r.status}` })
        setRepos([])
        return
      }
      const d = await r.json()
      setWritesEnabled(Boolean(d.writes_enabled))
      if (d.error === 'no_org_bound') {
        setConn({ kind: 'unbound' })
        setRepos([])
        return
      }
      if (d.error) {
        // NOT an empty list. A credential that cannot authenticate and an org
        // with no repositories are different facts and are shown differently.
        setConn({ kind: 'error', detail: String(d.error) })
        setRepos([])
        return
      }
      setConn({ kind: 'ok', org: d.org, authMode: d.auth_mode })
      setRepos(Array.isArray(d.repos) ? d.repos : [])
    } catch (e) {
      setConn({ kind: 'error', detail: e instanceof Error ? e.message : 'unknown' })
      setRepos([])
    }
  }, [apiBase])

  useEffect(() => {
    load()
    fetch(`${apiBase}/agents`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return
        setAgents(Array.isArray(d.agents) ? d.agents : [])
        if (d.forge_url) setForgeUrl(String(d.forge_url))
      })
      .catch(() => { /* agent roster is additive; its absence is not an error */ })
  }, [apiBase, load])

  useEffect(() => {
    if (!autoRefresh) return
    const t = setInterval(load, refreshIntervalMs)
    return () => clearInterval(t)
  }, [autoRefresh, refreshIntervalMs, load])

  const openIssues = useCallback(
    async (repo: string) => {
      if (openRepo === repo) { setOpenRepo(null); return }
      setOpenRepo(repo)
      setIssues([])
      setIssuesError(null)
      try {
        const r = await fetch(`${apiBase}/issues?repo=${encodeURIComponent(repo)}`,
          { credentials: 'include' })
        const d = await r.json()
        if (d.error) { setIssuesError(String(d.error)); return }
        setIssues(Array.isArray(d.issues) ? d.issues : [])
      } catch (e) {
        setIssuesError(e instanceof Error ? e.message : 'unknown')
      }
    },
    [apiBase, openRepo],
  )

  const assign = useCallback(
    async (repo: string, issueNumber: number, agent: string) => {
      const r = await fetch(`${apiBase}/issues/assign`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repo, issue_number: issueNumber, agent }),
      })
      if (!r.ok) {
        const d = await r.json().catch(() => ({}))
        setIssuesError(d.detail || `assign failed: HTTP ${r.status}`)
      }
    },
    [apiBase],
  )

  if (conn.kind === 'loading') return <div style={S.wrap}>Loading…</div>

  if (conn.kind === 'unbound') {
    return (
      <div style={S.wrap}>
        <h2 style={S.h}>GitHub</h2>
        <p style={S.muted}>
          No GitHub organization is connected to this workspace yet.
        </p>
      </div>
    )
  }

  if (conn.kind === 'error') {
    return (
      <div style={S.wrap}>
        <h2 style={S.h}>GitHub</h2>
        <p style={S.err}>Could not reach GitHub: {conn.detail}</p>
        <p style={S.muted}>
          This is not an empty organization — the request failed. Nothing is
          shown rather than showing something that looks like data.
        </p>
      </div>
    )
  }

  return (
    <div style={S.wrap}>
      <h2 style={S.h}>
        {conn.org}
        <span style={S.badge}>{repos.length} repos</span>
        {conn.authMode && <span style={S.badge}>{conn.authMode}</span>}
        {!writesEnabled && <span style={S.badgeRo}>read-only</span>}
      </h2>

      {repos.length === 0 && (
        <p style={S.muted}>This organization has no repositories.</p>
      )}

      {repos.map((r) => (
        <div key={r.full_name} style={S.row}>
          <div style={S.rowTop}>
            <a href={r.html_url} target="_blank" rel="noreferrer" style={S.link}>
              {r.name}
            </a>
            <span style={S.branch}>{r.default_branch}</span>
            {r.language && <span style={S.muted}>{r.language}</span>}
            <button style={S.btn} onClick={() => openIssues(r.name)}>
              {r.open_issues_count} issues
            </button>
            <a
              href={r.forge_url || `${forgeUrl}/ide?repo=${conn.org}/${r.name}`}
              target="_blank"
              rel="noreferrer"
              style={S.forge}
              title="Open in ForgeIDE — editor, live terminal and Demiurge"
            >
              Open in ForgeIDE
            </a>
          </div>
          {r.description && <div style={S.muted}>{r.description}</div>}

          {openRepo === r.name && (
            <div style={S.issues}>
              {issuesError && <div style={S.err}>{issuesError}</div>}
              {!issuesError && issues.length === 0 && (
                <div style={S.muted}>No open issues.</div>
              )}
              {issues.map((i) => (
                <div key={i.number} style={S.issue}>
                  <a href={i.html_url} target="_blank" rel="noreferrer" style={S.link}>
                    #{i.number} {i.title}
                  </a>
                  {writesEnabled ? (
                    <select
                      style={S.sel}
                      defaultValue=""
                      onChange={(e) => {
                        if (e.target.value) assign(r.name, i.number, e.target.value)
                      }}
                    >
                      <option value="">send to…</option>
                      {agents.map((a) => (
                        <option key={a.name} value={a.name} title={a.role}>
                          {a.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span style={S.muted} title="Enable writes for this workspace once the org has consented">
                      read-only
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

const S: Record<string, React.CSSProperties> = {
  wrap: { padding: 16, fontFamily: 'system-ui, sans-serif', fontSize: 14 },
  h: { fontSize: 18, margin: '0 0 12px', display: 'flex', alignItems: 'center', gap: 8 },
  badge: { fontSize: 11, opacity: 0.7, border: '1px solid currentColor', borderRadius: 4, padding: '1px 6px' },
  badgeRo: { fontSize: 11, opacity: 0.9, background: '#7a4', color: '#fff', borderRadius: 4, padding: '1px 6px' },
  row: { padding: '10px 0', borderTop: '1px solid rgba(128,128,128,0.25)' },
  rowTop: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  link: { fontWeight: 600, textDecoration: 'none', color: 'inherit' },
  branch: { fontSize: 11, opacity: 0.75, border: '1px solid currentColor', borderRadius: 4, padding: '1px 6px' },
  muted: { opacity: 0.7, fontSize: 12 },
  err: { color: '#c33', fontSize: 13, margin: '4px 0' },
  btn: { fontSize: 12, cursor: 'pointer', padding: '2px 8px' },
  forge: { fontSize: 12, textDecoration: 'none', color: '#ff5c1f', fontWeight: 600 },
  issues: { marginTop: 8, paddingLeft: 12, borderLeft: '2px solid rgba(128,128,128,0.3)' },
  issue: { display: 'flex', alignItems: 'center', gap: 10, padding: '3px 0' },
  sel: { fontSize: 11 },
}
