import type { ReactNode } from 'react'

/**
 * SelfEmbedGuard — refuses to render the app inside an iframe served from the
 * app's OWN origin.
 *
 * The only way that happens is a misconfigured embed (e.g. RelayEmbedPanel
 * falling back to same-origin /relay because /api/config/embed returned no
 * relay_base_url): the SPA catch-all answers the iframe request and the app
 * nests inside itself, recursively. Cross-origin parents (the portal framing a
 * tenant app, the tunnel, etc.) are legitimate and render normally — reading
 * window.top.location throws for them, which we treat as "not self-framed".
 *
 * Mount once at the app root, OUTSIDE panel routing:
 *   <SelfEmbedGuard><App /></SelfEmbedGuard>
 */
export default function SelfEmbedGuard({ children }: { children: ReactNode }) {
  let framedBySelf = false
  if (typeof window !== 'undefined' && window.self !== window.top) {
    try {
      framedBySelf = window.top!.location.origin === window.location.origin
    } catch {
      framedBySelf = false
    }
  }

  if (!framedBySelf) return <>{children}</>

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      height: '100vh', padding: '2rem', textAlign: 'center', gap: '0.5rem',
      background: 'var(--bg-deep, #09090b)', color: 'var(--text-primary, #e0e0e0)',
      fontFamily: 'system-ui, sans-serif',
    }}>
      <div style={{ fontSize: '1rem', fontWeight: 700 }}>This view isn't configured yet</div>
      <div style={{ fontSize: '0.85rem', color: 'var(--text-muted, #888)', maxWidth: 420 }}>
        The app tried to embed itself — usually a missing relay embed URL.
        Operators: set <code>AITHER_RELAY_PUBLIC_URL</code> so the Comms panel
        points at the platform relay instead of this app's own origin.
      </div>
    </div>
  )
}
