'use client'

/**
 * useUserActivity — publish what the user is DOING onto the event spine.
 *
 * This is the publisher half of the keystone gap. The ambient bus already
 * existed — six pillars, 78 shell events, AeonEmit, generated mirrors, AE004
 * keeping them in sync — and `user_activity` was classified onto it (AE008).
 * Nothing emitted it, so no app could react to another.
 *
 * ## Why /api/harness/events and not /api/flux/emit
 *
 * These are two DIFFERENT namespaces and picking the wrong one fails silently:
 *
 *   - `user_activity` lives in SHELL_EVENT_PILLARS (AitherEventSpine.py:147).
 *     Shell events travel by AeonEmit to the harness daemon, which exposes
 *     `POST /events` (daemon.py:1028, authenticated). Veil proxies it at
 *     `api/harness/[...path]`, which exports POST and injects
 *     AITHER_HARNESS_TOKEN.
 *   - Flux `/emit` expects FLUX CODES (`sns.a`, `rfx.t`, `llm.p`) classified by
 *     FLUX_PILLARS, a separate map starting at line 244. A shell event posted
 *     there is ACCEPTED and lands in no lane — a 200 that means nothing.
 *
 * An earlier attempt at this hook posted to `/api/events/emit`, which does not
 * exist at all, and swallowed the 404 into a console.warn. It would have
 * mounted, run, emitted nothing and reported success.
 *
 * ## Why it is gated on hasRoutes
 *
 * desktop-core is shared between AitherVeil (a Next app with API routes) and
 * the tenant portals (static SPAs on GitHub Pages with NO server at all). A
 * tenant has no `/api/harness/*` to post to, so publishing there is not
 * "degraded", it is impossible. `hasRoutes` is the catalogue's existing answer
 * to exactly that question — the same flag the Dashboard control and the
 * launcher already use — so this reuses it rather than sniffing for the route.
 *
 * On a routeless host the hook is a DELIBERATE no-op and says so once, rather
 * than firing requests into a catch-all that returns index.html with HTTP 200.
 */

import { useEffect, useRef } from 'react'
import { useAppCatalog } from '../contexts/app-catalog-context'

/** Shell event type — must stay in step with SHELL_EVENT_PILLARS. */
export const USER_ACTIVITY_EVENT = 'user_activity'

export interface UserActivity {
  /** What happened: 'app_opened' | 'app_focused' | 'app_closed' | … */
  action: string
  /** The app this is about (catalogue app id). */
  appId: string
  /** Anything else worth carrying; kept small on purpose. */
  detail?: Record<string, unknown>
}

export interface PublishResult {
  published: boolean
  /** Why not, when published is false. Never silently empty. */
  reason?: 'no-routes' | 'http-error' | 'network-error'
  status?: number
}

/**
 * Publish one activity event. Returns WHY it did not publish rather than
 * swallowing — a caller that wants to surface a dead bus can.
 */
export async function publishUserActivity(
  activity: UserActivity,
  hasRoutes: boolean,
): Promise<PublishResult> {
  if (!hasRoutes) {
    // Not a failure: this host has no server to publish to.
    return { published: false, reason: 'no-routes' }
  }
  try {
    const response = await fetch('/api/harness/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event_type: USER_ACTIVITY_EVENT,
        source: 'desktop-core',
        data: {
          action: activity.action,
          app_id: activity.appId,
          ...(activity.detail ?? {}),
        },
      }),
    })
    if (!response.ok) {
      return { published: false, reason: 'http-error', status: response.status }
    }
    return { published: true }
  } catch {
    return { published: false, reason: 'network-error' }
  }
}

/**
 * Emit `app_opened` when an app mounts and `app_closed` when it unmounts.
 *
 * The ref guard matters: React 18 StrictMode mounts effects twice in
 * development, and without it every open would publish two events — which
 * looks like a user double-clicking everything in whatever consumes this.
 */
export function useUserActivity(appId: string | null | undefined): void {
  const { hasRoutes } = useAppCatalog()
  const announced = useRef<string | null>(null)

  useEffect(() => {
    if (!appId) return
    if (announced.current === appId) return
    announced.current = appId

    void publishUserActivity({ action: 'app_opened', appId }, hasRoutes)

    return () => {
      announced.current = null
      void publishUserActivity({ action: 'app_closed', appId }, hasRoutes)
    }
  }, [appId, hasRoutes])
}

export default useUserActivity
