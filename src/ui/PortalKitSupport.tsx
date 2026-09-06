import SupportWidget from './SupportWidget'
import { getApiBase } from '../lib/apiBase'

export interface PortalKitSupportProps {
  /**
   * Backend API prefix. Default '' = same-origin — the app's own backend,
   * which must expose `POST /api/feedback` that routes `type: "bug_report"`
   * to Genesis `/feedback/bug-report` (→ the autonomous Atlas/Lyra/Demiurge
   * triage loop) and `type: "feature_request"`/ratings appropriately.
   */
  apiBase?: string
  /** Human app name shown in the widget + stamped on reports (e.g. "Acme"). */
  appName?: string
  position?: 'bottom-right' | 'bottom-left'
  /** Relay WebSocket URL override (default: same-origin /api/platform/ws/relay). */
  relayWsUrl?: string
  /** Optional link to a full support page — only rendered when provided. */
  supportPageUrl?: string
  /** Distance from the bottom edge (default 88 — clears the ChatPanel composer). */
  offsetBottom?: number
  /** Distance from the side edge (default 20). */
  offsetSide?: number
}

/**
 * PortalKitSupport — the ONE feedback surface every awkit tenant app mounts.
 *
 * Drop `<PortalKitSupport appName="Acme" />` once (in the app shell or App root)
 * and customers get the floating feedback / bug-report button, wired to the
 * platform triage loop. Kept here — NOT copied per app — so current and
 * future tenant apps stay consistent. `PortalShell` mounts this by default, so
 * apps that adopt the shared shell get it for free.
 */
export default function PortalKitSupport({
  // Default resolved from the RUNTIME config, never a bare ''.
  //
  // A '' default means SAME-ORIGIN, which is correct for a backend-hosted
  // app and wrong for a STATIC one. Relative /api/* fetches survive it
  // because installIdentityHeaders wraps window.fetch and rewrites them --
  // but a WebSocket is NOT window.fetch, so the chat URL below is built
  // from window.location.host and dials the static host directly.
  //
  // Measured 2026-08-21 on a tenant portal (GitHub Pages + a separate
  // API backend): wss://<portal-host>/api/platform/ws/relay -> 404, while
  // wss://<api-host>/api/platform/ws/relay -> 101 Switching
  // Protocols. The correct origin was already published in /config.js and
  // this component was the only thing not reading it, so support chat said
  // 'unavailable' on every tenant while the socket was healthy.
  //
  // getApiBase() returns '' when no absolute base is configured, so a
  // same-origin deployment behaves exactly as before.
  apiBase = getApiBase(),
  appName,
  position = 'bottom-right',
  relayWsUrl,
  supportPageUrl,
  offsetBottom,
  offsetSide,
}: PortalKitSupportProps) {
  return (
    <SupportWidget
      apiBase={apiBase}
      appName={appName}
      position={position}
      relayWsUrl={relayWsUrl}
      supportPageUrl={supportPageUrl}
      offsetBottom={offsetBottom}
      offsetSide={offsetSide}
    />
  )
}
