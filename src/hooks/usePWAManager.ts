/**
 * usePWAManager — Manages PWA install prompts and service worker registration.
 * Handles beforeinstallprompt events and exposes installReady/promptInstall.
 * Safely no-ops during SSR.
 */

import { useEffect, useState, useCallback } from 'react'

/**
 * BeforeInstallPromptEvent is a custom DOM event fired by browsers
 * that support add-to-home-screen / installable PWAs.
 */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

interface PWAState {
  installReady: boolean
  promptInstall: () => Promise<void>
}

/**
 * Register a service worker and manage PWA install prompts.
 *
 * @param swUrl Service worker URL (e.g., '/sw.js')
 * @returns { installReady, promptInstall } — installReady is true when the install prompt is available
 *
 * @example
 * const { installReady, promptInstall } = usePWAManager('/sw.js')
 * if (installReady) {
 *   return <button onClick={promptInstall}>Install App</button>
 * }
 */
export function usePWAManager(swUrl: string = '/sw.js'): PWAState {
  const [installReady, setInstallReady] = useState(false)
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null)

  useEffect(() => {
    // SSR safety
    if (typeof window === 'undefined') return

    // Register service worker
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register(swUrl).catch(() => {
        // Silent fail: SW registration errors are non-blocking
      })
    }

    // Capture beforeinstallprompt event (fires on browsers that support install)
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault()
      setDeferredPrompt(e as BeforeInstallPromptEvent)
      setInstallReady(true)
    }

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt)

    // Clear install banner after successful install
    const handleAppInstalled = () => {
      setDeferredPrompt(null)
      setInstallReady(false)
    }

    window.addEventListener('appinstalled', handleAppInstalled)

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
      window.removeEventListener('appinstalled', handleAppInstalled)
    }
  }, [swUrl])

  const promptInstall = useCallback(async () => {
    if (!deferredPrompt) return

    try {
      deferredPrompt.prompt()
      const { outcome } = await deferredPrompt.userChoice
      if (outcome === 'accepted') {
        setDeferredPrompt(null)
        setInstallReady(false)
      }
    } catch (err) {
      // Silent fail: install prompt errors are non-blocking
    }
  }, [deferredPrompt])

  return { installReady, promptInstall }
}
