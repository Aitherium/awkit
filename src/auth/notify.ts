/**
 * Fallback notifier for hosts with no toaster (the IdP-hosted bundle).
 *
 * Veil passes `sonner`. This exists so the hosted page is not silent about
 * failures — a login form that swallows "we could not send your code" is the
 * exact failure this whole consolidation is meant to end.
 */

import type { Notifier } from './types'

const CONTAINER_ID = 'aither-signin-toasts'
type Kind = 'success' | 'error' | 'info'

const TONE: Record<Kind, string> = {
    success: 'border-emerald-500/40 bg-emerald-950/90 text-emerald-200',
    error: 'border-red-500/40 bg-red-950/90 text-red-200',
    info: 'border-blue-500/40 bg-blue-950/90 text-blue-200',
}

function container(): HTMLElement | null {
    if (typeof document === 'undefined') return null
    let el = document.getElementById(CONTAINER_ID)
    if (!el) {
        el = document.createElement('div')
        el.id = CONTAINER_ID
        el.className = 'fixed top-4 right-4 z-50 flex flex-col gap-2 max-w-sm'
        // Announce politely so a screen reader hears the failure too.
        el.setAttribute('role', 'status')
        el.setAttribute('aria-live', 'polite')
        document.body.appendChild(el)
    }
    return el
}

function show(kind: Kind, message: string, duration = 5000): void {
    const root = container()
    if (!root) return
    const toast = document.createElement('div')
    toast.className =
        `rounded-lg border px-4 py-3 text-sm shadow-2xl transition-opacity duration-300 ${TONE[kind]}`
    toast.textContent = message
    root.appendChild(toast)
    setTimeout(() => {
        toast.style.opacity = '0'
        setTimeout(() => toast.remove(), 300)
    }, duration)
}

export const domNotifier: Notifier = {
    success: msg => show('success', msg),
    error: msg => show('error', msg, 8000),
    info: (msg, opts) => show('info', msg, opts?.duration ?? 5000),
}
