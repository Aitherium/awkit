/**
 * useSyncData — React hook for offline-first sync
 * ===============================================
 * Provides [value, setValue, status] for a key in a namespace.
 * SSR-safe: no-ops on server (returns undefined/empty status).
 *
 * Usage:
 *   const [notes, setNotes, { syncing, offline, lastSync }] = useSyncData('app-config', 'user-prefs')
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { SyncClient } from './SyncClient'

export interface SyncStatus {
  syncing: boolean
  offline: boolean
  lastSync: string | null
  error?: string
}

const clientCache = new Map<string, SyncClient>()

function getClient(namespace: string): SyncClient {
  if (!clientCache.has(namespace)) {
    clientCache.set(namespace, new SyncClient(namespace))
  }
  return clientCache.get(namespace)!
}

/**
 * Hook for syncing a single key in a namespace.
 * SSR-safe: returns empty/undefined on server.
 */
export function useSyncData(
  namespace: string,
  key: string
): [
  value: any,
  setValue: (value: any) => Promise<void>,
  status: SyncStatus
] {
  const isSSR = typeof window === 'undefined'

  const [value, setValue] = useState<any>(undefined)
  const [status, setStatus] = useState<SyncStatus>({
    syncing: false,
    offline: isSSR,
    lastSync: null,
  })

  const clientRef = useRef<SyncClient | null>(null)
  const unsubscribeRef = useRef<(() => void) | null>(null)

  // Initialize client and load from IndexedDB
  useEffect(() => {
    if (isSSR) return

    const client = getClient(namespace)
    clientRef.current = client

    let mounted = true

    const loadValue = async () => {
      try {
        await client.init()
        const val = await client.get(key)
        if (mounted) {
          setValue(val)
          setStatus((s) => ({
            ...s,
            offline: !client.getOnlineStatus(),
          }))
        }

        // Subscribe to local changes
        const unsub = client.onLocalChange(() => {
          client.get(key).then((newVal) => {
            if (mounted) setValue(newVal)
          })
        })

        unsubscribeRef.current = unsub

        // Attempt pull on mount
        const pullResult = await client.pull()
        if (mounted) {
          setStatus((s) => ({
            ...s,
            lastSync: pullResult.lastSync,
            offline: !pullResult.online,
          }))

          // Reload value after pull
          const newVal = await client.get(key)
          if (mounted) setValue(newVal)
        }
      } catch (e: any) {
        if (mounted) {
          setStatus((s) => ({
            ...s,
            error: e.message,
          }))
        }
      }
    }

    loadValue()

    return () => {
      mounted = false
      if (unsubscribeRef.current) {
        unsubscribeRef.current()
      }
    }
  }, [namespace, key, isSSR])

  // Handle value updates
  const handleSetValue = useCallback(
    async (newValue: any) => {
      if (isSSR) return

      const client = clientRef.current
      if (!client) return

      try {
        setStatus((s) => ({ ...s, syncing: true }))
        await client.set(key, newValue)
        setStatus((s) => ({
          ...s,
          syncing: false,
          lastSync: new Date().toISOString(),
        }))
      } catch (e: any) {
        setStatus((s) => ({
          ...s,
          syncing: false,
          error: e.message,
        }))
      }
    },
    [key, isSSR]
  )

  return [value, handleSetValue, status]
}

/**
 * Hook for bulk operations on a namespace (pull/sync status).
 */
export function useSyncNamespace(namespace: string) {
  const isSSR = typeof window === 'undefined'
  const [status, setStatus] = useState<SyncStatus>({
    syncing: false,
    offline: isSSR,
    lastSync: null,
  })

  const clientRef = useRef<SyncClient | null>(null)

  useEffect(() => {
    if (isSSR) return

    const client = getClient(namespace)
    clientRef.current = client

    let mounted = true
    let pullInterval: NodeJS.Timeout | null = null

    const initialize = async () => {
      try {
        await client.init()
        setStatus((s) => ({
          ...s,
          offline: !client.getOnlineStatus(),
        }))

        // Pull on mount
        const pullResult = await client.pull()
        if (mounted) {
          setStatus((s) => ({
            ...s,
            lastSync: pullResult.lastSync,
            offline: !pullResult.online,
          }))
        }

        // Set up periodic pull (every 30 seconds if online)
        pullInterval = setInterval(async () => {
          if (client.getOnlineStatus()) {
            const result = await client.pull()
            if (mounted) {
              setStatus((s) => ({
                ...s,
                lastSync: result.lastSync,
              }))
            }
          }
        }, 30000)
      } catch (e: any) {
        if (mounted) {
          setStatus((s) => ({
            ...s,
            error: e.message,
          }))
        }
      }
    }

    initialize()

    return () => {
      mounted = false
      if (pullInterval) clearInterval(pullInterval)
    }
  }, [namespace, isSSR])

  const manualPull = useCallback(async () => {
    if (isSSR) return

    const client = clientRef.current
    if (!client) return

    try {
      setStatus((s) => ({ ...s, syncing: true }))
      const result = await client.pull()
      setStatus((s) => ({
        ...s,
        syncing: false,
        lastSync: result.lastSync,
        offline: !result.online,
      }))
    } catch (e: any) {
      setStatus((s) => ({
        ...s,
        syncing: false,
        error: e.message,
      }))
    }
  }, [isSSR])

  return { status, pull: manualPull }
}
