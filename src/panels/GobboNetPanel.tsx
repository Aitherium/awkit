'use client'

import React, { useEffect, useState } from 'react'

/**
 * GobboNetPanel — Local-First AI Chat Interface
 *
 * Mounts the GobboNet SPA from `/gobbonet` (same-origin path).
 *
 * ## IndexedDB Isolation & Same-Origin Mounting
 *
 * GobboNet uses IndexedDB for state persistence (characters, threads, vectors, telemetry).
 * IndexedDB is isolated PER-ORIGIN: if GobboNet is mounted in an iframe on a different
 * origin, it gets a SEPARATE IndexedDB store and the user's characters/history are LOST.
 *
 * DECISION: Mount GobboNet at `/gobbonet` (same origin as the portal).
 *
 * Why same-origin mount:
 * - IndexedDB state is transparent and shared across all `/gobbonet/*` paths
 * - No complex state bridge needed (users keep their data)
 * - Works as both a portal panel AND a standalone app at the same URL
 * - Compatible with GobboNet's zero-config philosophy
 *
 * Alternative considered & rejected:
 * - Iframe on different origin + state bridge: adds latency, complexity, and failure modes
 * - Migrate GobboNet state to portal's Postgres: breaks "local-first" promise
 * - Custom storage layer: breaks GobboNet's upstream codebase
 *
 * ## Implementation Notes
 *
 * - GobboNet is a vanilla HTML/CSS/JS SPA with no framework
 * - Served as-is at `/gobbonet/` (the upstream/ directory)
 * - All 24 JS + 15 CSS files are statically loaded by chat.html
 * - The panel renders an iframe to `/gobbonet/` (or embeds a `<base href>` wrapper if needed)
 *
 * ## Security & Trust
 *
 * GobboNet:
 * - Has **no auth layer** — runs on localhost:11434 (or user-configured llama.cpp server)
 * - Makes no outbound requests by default (zero bytes after setup, per upstream promise)
 * - Card imports are explicitly disabled by default (security default: no auto-run)
 * - Imported cards carrying JS are an RCE distribution channel if auto-enabled
 *
 * For the portal:
 * - Same-origin mounting means portal cookies + auth are visible to GobboNet's JS
 * - GobboNet's HTTPS config is inherited from the portal's own security posture
 * - No additional trust boundary (GobboNet is trusted code vendored into the repo)
 */

export interface GobboNetPanelProps {
  /** API base URL for the panel routing (unused; GobboNet is self-contained) */
  apiBase?: string
}

export default function GobboNetPanel({ apiBase = '/gobbonet' }: GobboNetPanelProps) {
  const [isLoaded, setIsLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // Verify GobboNet is reachable at /gobbonet/chat.html
    const verifyAccess = async () => {
      try {
        // A HEAD that returns 200 proves NOTHING on a static host. Both
        // aitherium.com and dgg.aitherium.com answer 200 for this path;
        // only the first actually has the file. GitHub Pages serves the
        // SPA fallback (the app's own index.html) for anything missing, so
        // `res.ok` was true on every tenant and the iframe then rendered
        // THE ENTIRE DESKTOP INSIDE THIS PANEL -- a second taskbar, the
        // platform watermark, and, because aither_auth_token is scoped to
        // Domain=.aitherium.com, the platform session too.
        //
        // Measured 2026-08-20:
        //   aitherium.com/gobbonet/chat.html      -> <title>GOBBONET ...
        //   dgg.aitherium.com/gobbonet/chat.html  -> <!DOCTYPE html> ... _next
        //
        // So verify the CONTENT, not the status. GET the first bytes and
        // require the real page's marker; anything else is the fallback.
        // The hub (React workspace app) is the entry now — GNP001. The
        // classic vanilla chat still lives at /gobbonet/chat.html.
        const res = await fetch('/gobbonet/', { cache: 'no-store' })
        if (!res.ok) {
          setError(`Aither Hub not found at /gobbonet (HTTP ${res.status})`)
          return
        }
        const head = (await res.text()).slice(0, 2048)
        const isReal = /aither-hub-root/.test(head) && !/_next|__NEXT_DATA__/.test(head)
        if (!isReal) {
          setError(
            'Aither Hub is not deployed on this host. This origin answered 200 ' +
            'with the application shell instead of the hub page, which is ' +
            'what a static-host SPA fallback does for a missing path. Embedding ' +
            'it would nest the whole desktop inside this panel.'
          )
          return
        }
        setIsLoaded(true)
      } catch (err) {
        setError(
          err instanceof Error
            ? `Failed to reach Elysium: ${err.message}`
            : 'Failed to reach Elysium: Unknown error'
        )
      }
    }
    verifyAccess()
  }, [])

  return (
    <div style={{ padding: 0, height: '100%', display: 'flex', flexDirection: 'column' }}>
      {!isLoaded && !error && (
        <div
          style={{
            padding: 24,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            color: 'var(--text-secondary)',
          }}
        >
          <span>Loading Elysium...</span>
        </div>
      )}

      {error && (
        <div
          style={{
            padding: 24,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            color: 'var(--text-error, #ef4444)',
          }}
        >
          <div>
            <h3 style={{ marginTop: 0, marginBottom: 8 }}>Elysium Not Available</h3>
            <p style={{ margin: 0, fontSize: 14, color: 'var(--text-secondary)' }}>
              {error}
            </p>
            <p style={{ margin: '8px 0 0 0', fontSize: 12, color: 'var(--text-secondary)' }}>
              Ensure the application is properly deployed and Elysium files are at /gobbonet/
            </p>
          </div>
        </div>
      )}

      {isLoaded && (
        <iframe
          src="/gobbonet/chat.html"
          style={{
            flex: 1,
            border: 'none',
            background: 'transparent',
            width: '100%',
            height: '100%',
          }}
          title="GobboNet Chat Interface"
          sandbox="allow-same-origin allow-scripts allow-popups allow-forms allow-modals allow-presentation"
        />
      )}
    </div>
  )
}
