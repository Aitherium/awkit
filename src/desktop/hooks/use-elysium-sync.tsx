/**
 * useElysiumSync — Stub for desktop-core.
 * The full implementation lives in AitherVeil. This provides the type
 * interface so desktop-core components can compile.
 */

'use client'

import { useState, useCallback } from 'react'

export type NodeSyncStatus = 'disconnected' | 'connecting' | 'connected' | 'syncing' | 'error'

export interface SyncPayload {
  type: string
  data: unknown
  timestamp: number
}

export interface ElysiumSyncState {
  nodeStatus: NodeSyncStatus
  isNodeReachable: boolean
  lastSyncTime: number | null
  nodeUrl: string | null
  syncState: (payload: SyncPayload) => Promise<boolean>
  pullState: (type: string) => Promise<unknown | null>
  setNodeUrl: (url: string | null) => void
}

export function useElysiumSync(): ElysiumSyncState {
  const [nodeUrl, setNodeUrl] = useState<string | null>(null)

  const syncState = useCallback(async (_payload: SyncPayload) => false, [])
  const pullState = useCallback(async (_type: string) => null, [])

  return {
    nodeStatus: 'disconnected',
    isNodeReachable: false,
    lastSyncTime: null,
    nodeUrl,
    syncState,
    pullState,
    setNodeUrl,
  }
}
