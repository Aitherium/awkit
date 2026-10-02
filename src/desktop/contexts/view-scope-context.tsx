/**
 * ViewScope Context — Stub for desktop-core.
 * The full implementation lives in AitherVeil. Desktop-core components that
 * need view scope receive it via the host app's provider tree.
 */

'use client'

import React, { createContext, useContext } from 'react'

export type AccessMode = 'local' | 'elysium' | 'gateway' | 'demo'
export type ViewScopeTier = 'platform' | 'admin' | 'tenant' | 'public'

export interface ViewScopeState {
  tenantId: string | null
  tenantSlug: string | null
  accessMode: AccessMode
  canViewPlatform: boolean
  isAdmin: boolean
  effectiveTier: ViewScopeTier
  localNodeUrl: string | null
}

interface ViewScopeContextValue extends ViewScopeState {
  setAccessModeOverride: (mode: AccessMode | null) => void
  toggleTenantView: () => void
  isTenantPreview: boolean
  setLocalNodeUrl: (url: string | null) => void
}

const defaultState: ViewScopeContextValue = {
  tenantId: null,
  tenantSlug: null,
  accessMode: 'local',
  canViewPlatform: true,
  isAdmin: false,
  effectiveTier: 'public',
  localNodeUrl: null,
  setAccessModeOverride: () => {},
  toggleTenantView: () => {},
  isTenantPreview: false,
  setLocalNodeUrl: () => {},
}

const ViewScopeContext = createContext<ViewScopeContextValue>(defaultState)

export function ViewScopeProvider({ children }: { children: React.ReactNode }) {
  return (
    <ViewScopeContext.Provider value={defaultState}>
      {children}
    </ViewScopeContext.Provider>
  )
}

export function useViewScope(): ViewScopeContextValue {
  return useContext(ViewScopeContext)
}
