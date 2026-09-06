'use client'

/**
 * PortalShell — Collapsible sidebar + main content layout.
 *
 * Supports two navigation modes:
 *  - "tabs" (default): renders a tab bar across the top of main content
 *  - "router": renders children directly (for react-router setups)
 *
 * The sidebar shows brand identity, nav items, user info, and -- on UNBRANDED
 * (platform) surfaces only -- a "Powered by" link naming the provider.
 */

import { useState, type ReactNode } from 'react'
import { useConfig } from '../hooks/useConfig'
import PortalKitSupport from '../ui/PortalKitSupport'

export interface NavItem {
  id: string
  label: string
  /** Path for router mode, tab ID for tabs mode */
  path?: string
  /** Optional badge text (e.g. "AI", "New") */
  badge?: string
  /** Whether this item appears at the bottom of the sidebar */
  bottom?: boolean
  /** Whether this item links externally */
  external?: boolean
  href?: string
}

export interface PortalShellProps {
  /** App name shown in sidebar header */
  appName: string
  /** Company name shown below app name */
  companyName?: string
  /** Navigation items */
  navItems: NavItem[]
  /** Currently active nav item ID */
  activeId: string
  /** Called when a nav item is clicked */
  onNavigate: (id: string) => void
  /** User display info */
  user?: { display_name?: string; name?: string; email?: string; role?: string } | null
  /** Called when sign out is clicked */
  onLogout?: () => void
  /** Whether user is in demo mode */
  isDemo?: boolean
  /** Demo banner label */
  demoLabel?: string
  /** Demo banner description */
  demoDescription?: string
  /** Content to render in the sidebar below nav (e.g. conversation list) */
  sidebarContent?: ReactNode
  /** Content to render at the very bottom of sidebar (e.g. activity feed) */
  sidebarFooter?: ReactNode
  /** Main content area */
  children: ReactNode
  /** Force the "Powered by" footer on or off. Defaults to showing it only
   *  on UNBRANDED (platform) surfaces -- a customer's own portal should not
   *  carry someone else's name in its sidebar by default. */
  showPoweredBy?: boolean
  /** Provider to name in that footer when it is shown. */
  platformName?: string
  /** Whether the shell is embedded (hides header) */
  embedded?: boolean
  /** Mount the shared feedback/support widget (default true). */
  supportWidget?: boolean
}

export default function PortalShell({
  appName,
  companyName,
  navItems,
  activeId,
  onNavigate,
  user,
  onLogout,
  isDemo,
  demoLabel,
  demoDescription,
  sidebarContent,
  sidebarFooter,
  children,
  showPoweredBy,
  platformName = 'Aitherium',
  embedded = false,
  supportWidget = true,
}: PortalShellProps) {
  // A configured company_name IS the tenant-branded signal; DEFAULT_CONFIG
  // leaves it '', so the platform's own surfaces are unchanged.
  const shellCfg = useConfig()
  const poweredBy = showPoweredBy ?? !shellCfg.company_name
  const [collapsed, setCollapsed] = useState(false)

  const mainNav = navItems.filter(n => !n.bottom)
  const bottomNav = navItems.filter(n => n.bottom)
  const brandInitial = appName.charAt(0).toUpperCase()
  const displayName = user?.display_name || user?.name || ''

  return (
    <div style={{ display: 'flex', width: '100%', height: '100vh', overflow: 'hidden', background: 'var(--bg-deep)' }}>
      {/* Sidebar */}
      <aside style={{
        width: collapsed ? 64 : 260,
        background: 'var(--sidebar-bg, var(--bg-base))',
        borderRight: '1px solid var(--sidebar-border, var(--glass-border))',
        display: 'flex',
        flexDirection: 'column',
        transition: 'width 0.2s ease',
        flexShrink: 0,
        overflow: 'hidden',
        boxShadow: 'inset -1px 0 0 var(--divider, rgba(0,0,0,0.4)), 4px 0 24px rgba(0, 0, 0, 0.18)',
      }}>
        {/* Brand header */}
        {!embedded && (
          <div style={{
            padding: collapsed ? '16px 12px' : '18px 16px 16px',
            borderBottom: '1px solid var(--divider, var(--glass-border))',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            background: 'linear-gradient(180deg, rgba(255,255,255,0.025) 0%, transparent 100%)',
          }}>
            <div style={{
              width: 34, height: 34, borderRadius: 9,
              background: 'var(--accent-primary)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '0.95rem', fontWeight: 700, color: 'var(--bg-deep)',
              flexShrink: 0,
              boxShadow: 'var(--brand-glow)',
            }}>
              {brandInitial}
            </div>
            {!collapsed && (
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: '0.95rem', color: 'var(--text-primary)' }}>{appName}</div>
                {companyName && (
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{companyName}</div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Section label: Navigation */}
        {!collapsed && (
          <div style={{
            padding: '14px 16px 6px',
            fontSize: '0.62rem', textTransform: 'uppercase', letterSpacing: '0.1em',
            color: 'var(--sidebar-section-label, var(--text-muted))', fontWeight: 600,
          }}>
            Workspace
          </div>
        )}

        {/* Main nav */}
        <nav style={{ flex: 1, padding: '0 8px 8px', display: 'flex', flexDirection: 'column', gap: 2, overflow: 'auto' }}>
          {mainNav.map(item => {
            const active = activeId === item.id
            if (item.external && item.href) {
              return (
                <a key={item.id} href={item.href} target="_blank" rel="noopener"
                  className="portal-shell-nav-item"
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '9px 12px', borderRadius: 'var(--radius)',
                    color: 'var(--text-muted)', fontSize: '0.8rem',
                    textDecoration: 'none',
                    justifyContent: collapsed ? 'center' : 'flex-start',
                  }}>
                  {!collapsed && <span>{item.label}</span>}
                </a>
              )
            }
            return (
              <button key={item.id} onClick={() => onNavigate(item.id)}
                className="portal-shell-nav-item"
                data-active={active ? 'true' : 'false'}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '9px 12px', borderRadius: 'var(--radius)',
                  background: active ? 'var(--sidebar-row-active-bg, var(--bg-elevated))' : 'transparent',
                  color: active ? 'var(--accent-primary)' : 'var(--text-secondary)',
                  fontSize: '0.85rem', fontWeight: active ? 600 : 400,
                  textAlign: 'left', width: '100%',
                  justifyContent: collapsed ? 'center' : 'flex-start',
                  borderLeft: active ? '2px solid var(--accent-primary)' : '2px solid transparent',
                  paddingLeft: active ? 10 : 12,
                  transition: 'background 0.12s ease, color 0.12s ease',
                }}>
                {!collapsed && <span>{item.label}</span>}
                {!collapsed && item.badge && (
                  <span style={{
                    marginLeft: 'auto', background: 'var(--accent-primary)',
                    color: 'var(--bg-deep)', fontSize: '0.58rem', padding: '2px 6px',
                    borderRadius: 8, fontWeight: 700,
                  }}>{item.badge}</span>
                )}
              </button>
            )
          })}

          {/* Sidebar injected content */}
          {sidebarContent}

          <div style={{ flex: 1 }} />

          {/* Bottom nav */}
          {bottomNav.length > 0 && !collapsed && (
            <div style={{
              padding: '10px 4px 2px',
              fontSize: '0.62rem', textTransform: 'uppercase', letterSpacing: '0.1em',
              color: 'var(--sidebar-section-label, var(--text-muted))', fontWeight: 600,
              borderTop: '1px solid var(--divider, var(--glass-border))', marginTop: 8,
            }}>
              System
            </div>
          )}
          {bottomNav.map(item => {
            const active = activeId === item.id
            if (item.external && item.href) {
              return (
                <a key={item.id} href={item.href} target="_blank" rel="noopener"
                  className="portal-shell-nav-item"
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '9px 12px', borderRadius: 'var(--radius)',
                    color: 'var(--text-muted)', fontSize: '0.8rem',
                    textDecoration: 'none',
                    justifyContent: collapsed ? 'center' : 'flex-start',
                  }}>
                  {!collapsed && <span>{item.label}</span>}
                </a>
              )
            }
            return (
              <button key={item.id} onClick={() => onNavigate(item.id)}
                className="portal-shell-nav-item"
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '9px 12px', borderRadius: 'var(--radius)',
                  background: active ? 'var(--sidebar-row-active-bg, var(--bg-elevated))' : 'transparent',
                  color: active ? 'var(--accent-primary)' : 'var(--text-muted)',
                  fontSize: '0.8rem', textAlign: 'left', width: '100%',
                  justifyContent: collapsed ? 'center' : 'flex-start',
                }}>
                {!collapsed && <span>{item.label}</span>}
              </button>
            )
          })}
        </nav>

        {/* Sidebar footer (e.g. activity feed) */}
        {sidebarFooter && !collapsed && (
          <div style={{ borderTop: '1px solid var(--divider, var(--glass-border))', overflow: 'auto', maxHeight: 200 }}>
            {sidebarFooter}
          </div>
        )}

        {/* User + collapse */}
        <div style={{
          padding: 12, borderTop: '1px solid var(--divider, var(--glass-border))',
          display: 'flex', alignItems: 'center', gap: 8,
          background: 'linear-gradient(0deg, rgba(0,0,0,0.18) 0%, transparent 100%)',
        }}>
          {!collapsed && displayName && (
            <>
              <div style={{
                width: 30, height: 30, borderRadius: '50%',
                background: 'var(--bg-elevated)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '0.72rem', fontWeight: 600, color: 'var(--accent-primary)',
                flexShrink: 0, border: '1px solid var(--glass-border)',
              }}>
                {displayName.charAt(0).toUpperCase()}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '0.78rem', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-primary)' }}>
                  {displayName}
                </div>
                {user?.email && (
                  <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.email}</div>
                )}
              </div>
              {onLogout && (
                <button onClick={onLogout} title="Sign out"
                  style={{ background: 'none', color: 'var(--text-muted)', padding: 4, fontSize: '0.7rem' }}>
                  Sign out
                </button>
              )}
            </>
          )}
          <button
            onClick={() => setCollapsed(!collapsed)}
            style={{
              background: 'var(--bg-elevated)', color: 'var(--text-secondary)', padding: '4px 8px',
              borderRadius: 6,
              marginLeft: collapsed ? 'auto' : 0, marginRight: collapsed ? 'auto' : 0,
              fontSize: '0.75rem',
              border: '1px solid var(--glass-border)',
            }}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? '>' : '<'}
          </button>
        </div>

        {/* Powered by */}
        {poweredBy && !collapsed && (
          <div style={{ padding: '8px 14px 10px', borderTop: '1px solid var(--divider, var(--glass-border))', background: 'var(--bg-deep)' }}>
            <a href="https://portal.aitherium.com" target="_blank" rel="noopener"
              style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textDecoration: 'none', letterSpacing: '0.04em' }}>
              Powered by {platformName}
            </a>
          </div>
        )}
      </aside>

      {/* Main content */}
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>
        {isDemo && (
          <div style={{
            background: 'linear-gradient(90deg, rgba(168, 85, 247, 0.12), rgba(236, 72, 153, 0.08))',
            borderBottom: '1px solid rgba(168, 85, 247, 0.2)',
            padding: '8px 16px', display: 'flex', alignItems: 'center', gap: 8,
            fontSize: '0.75rem', color: 'var(--text-secondary)',
          }}>
            <span style={{ color: 'var(--accent-primary)', fontWeight: 600 }}>{demoLabel || 'Demo Mode'}</span>
            {demoDescription && <span>&mdash; {demoDescription}</span>}
          </div>
        )}
        {children}
      </main>
      {/* Consistent feedback surface for every app that adopts the shell —
          floating bug/feedback button wired to the platform triage loop. */}
      {supportWidget !== false && <PortalKitSupport appName={appName} />}
    </div>
  )
}
