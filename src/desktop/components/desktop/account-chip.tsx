'use client'

/**
 * AccountChip — who is signed in to this desktop, and the one door in or out.
 * ==========================================================================
 *
 * Owner, 2026-10-01: "AITHERDESKTOP DOESNT SHOW ME AS SIGNED IN ... THERE IS NOWHERE
 * TO EVEN SIGN IN". The taskbar had a clock, a tray and a mode toggle, and no idea
 * who was using it; the only auth control was a log-out icon buried in the Start
 * Menu footer, shown to signed-out visitors too. The Living Desktop's dock has had
 * an account chip since 2026-07-24 (dock.tsx AccountChip); this is that chip for
 * the DesktopShell, so the two desktops answer "am I signed in?" the same way.
 *
 * Auth lives in the HOST, never here: the host passes a `DesktopIdentity` (who, and
 * the sign-in / sign-out / account / devices actions). A host that passes none gets
 * no chip at all rather than a chip that guesses.
 *
 * States:
 *   loading    -> a quiet placeholder. Never flash "Sign in" at a signed-in owner
 *                 while the session restores.
 *   anonymous  -> a prominent accent "Sign in" button.
 *   signed in  -> avatar (or initials) + name; click opens a menu: header (name,
 *                 email), Account, Devices, Sign out.
 */

import React, { useEffect, useRef, useState } from 'react'
import { LogIn, LogOut, MonitorSmartphone, UserRound } from 'lucide-react'

export interface DesktopAccount {
  /** Display name, already resolved by the host (display_name || username). */
  name: string
  email?: string
  avatarUrl?: string
}

export interface DesktopIdentity {
  /** The signed-in account, or null for an anonymous visitor. */
  account: DesktopAccount | null
  /** True while the host is still restoring the session. */
  loading?: boolean
  /** Start the host's sign-in flow (anonymous state). */
  onSignIn: () => void
  /** Sign out (signed-in state). Omitted = no Sign out item. */
  onSignOut?: () => void
  /** Open the account / profile surface. Omitted = no Account item. */
  onOpenAccount?: () => void
  /** Open this-device / linked devices (awdk, awsh, awdesk). Omitted = no item. */
  onOpenDevices?: () => void
}

/** "David Parker" -> "DP", "wizzense" -> "W", "" -> "?". */
export function accountInitials(name: string): string {
  const parts = name.trim().split(/[\s._-]+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase()
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase()
}

function Avatar({ account, size }: { account: DesktopAccount; size: 'sm' | 'md' }) {
  const [broken, setBroken] = useState(false)
  const box = size === 'sm' ? 'h-6 w-6 text-[10px]' : 'h-9 w-9 text-xs'
  if (account.avatarUrl && !broken) {
    return (
      <img
        src={account.avatarUrl}
        alt=""
        referrerPolicy="no-referrer"
        onError={() => setBroken(true)}
        className={`${box} rounded-full object-cover ring-1 ring-white/15`}
      />
    )
  }
  return (
    <span
      aria-hidden="true"
      className={`${box} rounded-full grid place-items-center font-semibold bg-[#5EC9CC]/20 text-[#5EC9CC] ring-1 ring-[#5EC9CC]/30`}
    >
      {accountInitials(account.name)}
    </span>
  )
}

export function AccountChip({ identity }: { identity: DesktopIdentity }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const { account, loading } = identity

  // Close on an outside click or Escape. Registered only while open.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (loading && !account) {
    return (
      <div
        data-testid="desktop-account-chip"
        data-signed-in="loading"
        aria-label="Checking your session"
        className="h-8 w-20 rounded-lg bg-white/[0.04] animate-pulse"
      />
    )
  }

  if (!account) {
    return (
      <button
        type="button"
        onClick={identity.onSignIn}
        data-testid="desktop-account-chip"
        data-signed-in="false"
        aria-label="Sign in"
        title="Sign in once and every app on this desktop unlocks"
        className="flex items-center gap-1.5 px-3 h-8 rounded-lg bg-[#5EC9CC] text-[#050507] text-xs font-semibold hover:brightness-110 active:scale-[0.98] transition-all shadow-[0_0_12px_rgba(94,201,204,0.25)]"
      >
        <LogIn className="w-3.5 h-3.5" />
        <span>Sign in</span>
      </button>
    )
  }

  const item = 'w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs text-zinc-300 hover:bg-white/[0.06] hover:text-white transition-colors text-left'

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        data-testid="desktop-account-chip"
        data-signed-in="true"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Signed in as ${account.name}`}
        title={`Signed in as ${account.name}`}
        className={`flex items-center gap-2 pl-1 pr-2.5 h-8 rounded-lg transition-colors ${open ? 'bg-white/10' : 'hover:bg-white/[0.06]'}`}
      >
        <Avatar account={account} size="sm" />
        {/* Truncated, never overflowing: the name is user-controlled text. */}
        <span className="hidden md:inline max-w-[9rem] truncate text-xs font-medium text-zinc-200">
          {account.name}
        </span>
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Account"
          data-testid="desktop-account-menu"
          className="absolute bottom-11 right-0 w-64 rounded-xl border border-zinc-700/80 bg-zinc-900/95 backdrop-blur-xl shadow-2xl shadow-black/50 p-1.5 z-[260]"
        >
          <div className="flex items-center gap-3 px-3 py-2.5">
            <Avatar account={account} size="md" />
            <div className="min-w-0">
              <div className="text-sm font-medium text-white truncate">{account.name}</div>
              {account.email && <div className="text-[11px] text-zinc-500 truncate">{account.email}</div>}
            </div>
          </div>
          <div className="h-px bg-white/[0.06] my-1" />
          {identity.onOpenAccount && (
            <button type="button" role="menuitem" className={item} onClick={() => { setOpen(false); identity.onOpenAccount?.() }}>
              <UserRound className="w-3.5 h-3.5 text-zinc-400" /> Account
            </button>
          )}
          {identity.onOpenDevices && (
            <button type="button" role="menuitem" className={item} onClick={() => { setOpen(false); identity.onOpenDevices?.() }}>
              <MonitorSmartphone className="w-3.5 h-3.5 text-zinc-400" /> Devices
              <span className="ml-auto text-[10px] text-zinc-600">awdk · awsh · awdesk</span>
            </button>
          )}
          {identity.onSignOut && (
            <>
              <div className="h-px bg-white/[0.06] my-1" />
              <button
                type="button"
                role="menuitem"
                className={`${item} hover:!bg-red-500/10 hover:!text-red-300`}
                onClick={() => { setOpen(false); identity.onSignOut?.() }}
              >
                <LogOut className="w-3.5 h-3.5" /> Sign out
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
