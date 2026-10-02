/**
 * The AitherDesktop launcher must not offer the platform's owner/admin apps to an
 * anonymous visitor or a free signed-in user, and must offer them to an operator.
 *
 * Owner, 2026-10-01: he saw Admin / Tenant Management / Roles & Permissions in his
 * launcher -- right for the owner; this pins that nobody else does. Entries are
 * built exactly the way start-menu.tsx builds them ({ id, hasWidget }), from the
 * real manifest, so a new admin app inherits the assertion.
 */
import React from 'react'
import { renderHook } from '@testing-library/react'
import { AppCatalogProvider, useAppCatalog, type AppCatalogScope } from '../app-catalog-context'
import { ALL_APPS } from '../../data/apps-manifest'

const ADMIN_IDS = ['admin', 'admin-users', 'admin-tenants', 'admin-roles']

function visible(scope: AppCatalogScope): string[] {
  const { result } = renderHook(() => useAppCatalog(), {
    wrapper: ({ children }) => <AppCatalogProvider {...scope}>{children}</AppCatalogProvider>,
  })
  return ALL_APPS
    .filter(a => ADMIN_IDS.includes(a.id))
    .filter(a => result.current.isAllowed({ id: a.id, hasWidget: !!(a as { desktopWidget?: unknown }).desktopWidget }))
    .map(a => a.id)
}

describe('AitherDesktop catalog: admin apps', () => {
  it('the manifest still carries the admin apps this guards', () => {
    const ids = ALL_APPS.map(a => a.id)
    for (const id of ADMIN_IDS) expect(ids).toContain(id)
  })

  it('hides them from an anonymous visitor', () => {
    expect(visible({ authenticated: false })).toEqual([])
  })

  it('hides them from a signed-in free user with no platform permission', () => {
    expect(visible({ authenticated: true, tier: 'free', can: () => false })).toEqual([])
  })

  it('hides them from a workspace admin (workspace:admin is not platform)', () => {
    const can = (r: string, a: string) => r === 'workspace' && a === 'admin'
    expect(visible({ authenticated: true, tier: 'pro', can })).toEqual([])
  })

  it('shows them to a platform operator', () => {
    expect(visible({ authenticated: true, tier: 'platform', can: () => true }).sort()).toEqual([...ADMIN_IDS].sort())
  })
})
