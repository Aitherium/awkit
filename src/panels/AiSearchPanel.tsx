'use client'

import { useState, useCallback } from 'react'

interface SearchSource {
  title: string
  url: string
  snippet?: string
}

export interface AiSearchPanelProps {
  apiBase?: string
}

/* THE DEFAULT USED TO BE '/api/ai-search', WHICH EXISTS NOWHERE ON THIS PLATFORM.
 *
 * That route is served only by tenant backends (awkit-backend and other
 * tenant backends) —
 * i.e. by a deployment where the panel and a FastAPI app share an origin. This
 * panel also ships inside the Living OS desktop, whose origin is aitherium.com:
 * a static export with no API routes at all. Measured 2026-08-19:
 *     POST https://aitherium.com/api/ai-search      -> 405, text/html
 *     POST https://portal.aitherium.com/api/ai-search -> 401 (route does not exist)
 * So on the desktop this panel could NEVER have returned a result, and it failed
 * as a SILENCE — see the render notes below.
 *
 * `/api/search/web` is the endpoint that actually answers, anonymously, with the
 * SAME request body this panel already sent. Verified live the same day:
 *     POST https://portal.aitherium.com/api/search/web {"query":"news"} -> 200
 * Relative on purpose: a tenant deployment serves it same-origin, and on the
 * static export lib/api-proxy.ts's global fetch interceptor rewrites /api/* to
 * the live backend with credentials. Hardcoding a host here would be a second
 * source of truth for "where is the API", which is exactly how the old default
 * drifted into pointing at nothing. */
export default function AiSearchPanel({ apiBase = '/api/search/web' }: AiSearchPanelProps) {
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [answer, setAnswer] = useState('')
  const [sources, setSources] = useState<SearchSource[]>([])
  const [grounded, setGrounded] = useState(true)
  const [searched, setSearched] = useState(false)
  const [error, setError] = useState('')

  const run = useCallback(async () => {
    const q = query.trim()
    if (!q) return
    setLoading(true)
    setSearched(true)
    setAnswer('')
    setSources([])
    setError('')
    try {
      const res = await fetch(apiBase, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q, max_results: 6 }),
      })
      // r.json() on an HTML error page throws a SyntaxError whose message names
      // a character offset, which is useless to a reader. Read the status first
      // so a dead route says "dead route" rather than "Unexpected token <".
      if (!res.ok) {
        setError(
          res.status === 404 || res.status === 405
            ? "Search isn't available on this surface — the request reached a static page, not the search API."
            : res.status === 401 || res.status === 403
              ? 'Search needs a signed-in session on this surface.'
              : `Search failed (HTTP ${res.status}).`,
        )
        return
      }
      const data = await res.json().catch(() => null)
      if (!data) {
        setError('Search returned a response this panel could not read.')
        return
      }
      // Two shapes are live: /api/search/web answers {results:[{title,url,content}]},
      // the tenant AI route answers {answer, sources, web_grounded}. Accept both
      // rather than pinning one — the panel ships on both kinds of deployment.
      const mapped: SearchSource[] = Array.isArray(data.sources)
        ? data.sources
        : Array.isArray(data.results)
          ? data.results.map((r: Record<string, unknown>) => ({
              title: String(r.title ?? r.url ?? 'Untitled'),
              url: String(r.url ?? ''),
              snippet: String(r.snippet ?? r.content ?? ''),
            }))
          : []
      setAnswer(typeof data.answer === 'string' ? data.answer : '')
      setSources(mapped)
      setGrounded(data.web_grounded !== false)
    } catch (err) {
      setError(err instanceof Error ? `Search failed: ${err.message}` : 'Search failed.')
    } finally {
      setLoading(false)
    }
  }, [apiBase, query])

  return (
    <div style={{ padding: 24, height: '100%', overflow: 'auto', color: 'var(--text-primary)' }}>
      <h2 style={{ margin: '0 0 4px', fontSize: 20 }}>AI Search</h2>
      <p style={{ margin: '0 0 16px', color: 'var(--text-secondary)', fontSize: 13 }}>
        Web search with an AI summary and cited sources.
      </p>

      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') run() }}
          placeholder="Ask anything — e.g. fall mini-session pricing trends 2026"
          style={{
            flex: 1, padding: '10px 14px', borderRadius: 'var(--radius, 10px)', fontSize: 14,
            background: 'var(--bg-surface, #27202d)', color: 'var(--text-primary)',
            border: '1px solid var(--divider, rgba(255,255,255,0.1))', outline: 'none',
          }}
        />
        <button
          onClick={run}
          disabled={loading || !query.trim()}
          style={{
            padding: '10px 18px', borderRadius: 'var(--radius, 10px)', cursor: 'pointer',
            background: 'var(--accent-primary, #ec4899)', color: '#fff', border: 'none',
            opacity: loading || !query.trim() ? 0.6 : 1,
          }}
        >
          {loading ? 'Searching…' : 'Search'}
        </button>
      </div>

      {/* THE MISSING STATE. Before this, a search that returned nothing —  a dead
          route, an empty result set, a payload with no `answer` — set `searched`
          and then rendered NOTHING AT ALL: no error, no "no results", no change
          on screen. Clicking Search and having the panel sit there unchanged is
          indistinguishable from a button that is not wired up, which is exactly
          how it was reported ("doesn't even work"). Every terminal state now
          renders something. */}
      {error && (
        <div style={{
          padding: '10px 14px', marginBottom: 14, fontSize: 13, borderRadius: 8,
          background: 'rgba(248,113,113,0.08)', color: 'var(--text-primary)',
          border: '1px solid rgba(248,113,113,0.25)',
        }}>
          {error}
        </div>
      )}

      {searched && !loading && !error && !answer && sources.length === 0 && (
        <div style={{
          padding: '10px 14px', marginBottom: 14, fontSize: 13, borderRadius: 8,
          background: 'var(--bg-surface, #27202d)', color: 'var(--text-secondary)',
          border: '1px solid var(--divider, rgba(255,255,255,0.08))',
        }}>
          No results for “{query.trim()}”. Try different words.
        </div>
      )}

      {searched && !loading && !grounded && (
        <div style={{
          padding: '8px 12px', marginBottom: 14, fontSize: 12.5, borderRadius: 8,
          background: 'var(--card-hover, rgba(251,146,60,0.08))', color: 'var(--text-secondary)',
          border: '1px solid var(--divider, rgba(255,255,255,0.06))',
        }}>
          Live web results were unavailable — this answer is from the model's own
          knowledge and may be out of date.
        </div>
      )}

      {answer && (
        <div style={{
          padding: 18, borderRadius: 'var(--radius-lg, 14px)', marginBottom: 22, lineHeight: 1.6,
          background: 'var(--bg-surface, #27202d)',
          border: '1px solid var(--divider, rgba(255,255,255,0.06))', whiteSpace: 'pre-wrap',
        }}>
          {answer}
        </div>
      )}

      {sources.length > 0 && (
        <div>
          <h3 style={{ fontSize: 13, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
            Sources
          </h3>
          <div style={{ display: 'grid', gap: 8 }}>
            {sources.map((s, i) => (
              <a
                key={i}
                href={s.url}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: 'block', padding: 12, borderRadius: 'var(--radius, 10px)',
                  background: 'var(--bg-base, #1d1622)', textDecoration: 'none',
                  border: '1px solid var(--divider, rgba(255,255,255,0.06))', color: 'var(--text-primary)',
                }}
              >
                <div style={{ fontSize: 13.5, fontWeight: 600 }}>
                  [{i + 1}] {s.title}
                </div>
                {s.snippet && (
                  <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', marginTop: 3 }}>
                    {s.snippet.slice(0, 160)}
                  </div>
                )}
                <div style={{ fontSize: 11.5, color: 'var(--accent-primary, #ec4899)', marginTop: 3 }}>
                  {s.url}
                </div>
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
