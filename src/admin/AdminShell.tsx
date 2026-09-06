"use client";

import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { useEffect, useState } from "react";
import {
  BarChart3,
  Box,
  ChevronLeft,
  ExternalLink,
  FileText,
  LogOut,
  Package,
  Settings,
  ShoppingCart,
  Users,
} from "lucide-react";
import { getToken, getStoredUser, clearToken, clearStoredUser } from "./AdminAPI";

export interface AdminNavItem {
  href: string;
  icon?: React.ElementType;
  label: string;
}

export interface AdminShellProps {
  children: React.ReactNode;
  brandName?: string;
  navItems?: AdminNavItem[];
  storefrontHref?: string;
  portalUrl?: string;
  loginPath?: string;
  requireAuth?: boolean;
  /**
   * Property-scope badge required to enter this admin (e.g. "shop:admin").
   * Badges come from Identity /auth/me `scope_badges` (derived server-side
   * from RBAC roles; admin/super_admin hold all). Deployments without the
   * Identity bridge fall back to the legacy stored-role check.
   *
   * ⚠️ This is a CLIENT-SIDE UX gate, not a security boundary — like any
   * client check (incl. the localStorage fallback) it is bypassable in the
   * browser. The deployment's admin APIs must enforce auth server-side.
   */
  requiredBadge?: string;
  onLogout?: () => void;
}

const DEFAULT_NAV: AdminNavItem[] = [
  { href: "/admin", icon: BarChart3, label: "Dashboard" },
  { href: "/admin/products", icon: Package, label: "Products" },
  { href: "/admin/orders", icon: ShoppingCart, label: "Orders" },
  { href: "/admin/customers", icon: Users, label: "Customers" },
  { href: "/admin/reports", icon: BarChart3, label: "Reports" },
  { href: "/admin/blog", icon: FileText, label: "Blog" },
  { href: "/admin/settings", icon: Settings, label: "Settings" },
];

export default function AdminShell({
  children,
  brandName = "Admin",
  navItems = DEFAULT_NAV,
  storefrontHref = "/",
  portalUrl,
  loginPath = "/admin/login",
  requireAuth = false,
  requiredBadge,
  onLogout,
}: AdminShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<{ username: string; role: string } | null>(null);
  const [ready, setReady] = useState(!requireAuth);
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    if (!requireAuth) { setReady(true); return; }
    if (pathname === loginPath) { setReady(true); return; }
    const token = getToken();
    if (!token) { router.push(loginPath); return; }
    const stored = getStoredUser();
    setUser(stored);
    if (!requiredBadge) { setReady(true); return; }

    // Property-badge gate. The middleware/proxy enforces this server-side
    // where it exists; this client check keeps the admin UI itself honest.
    const legacyOk = !!stored && ["admin", "owner"].includes(stored.role);
    let cancelled = false;
    fetch("/api/auth/me", { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => (res.ok ? res.json() : null))
      .then((me) => {
        if (cancelled) return;
        if (me && Array.isArray(me.scope_badges)) {
          const roles: string[] = me.roles || [];
          setDenied(!(me.scope_badges.includes(requiredBadge)
            || roles.includes("admin") || roles.includes("super_admin")));
        } else {
          // No Identity bridge on this deployment — legacy stored-role check.
          setDenied(!legacyOk);
        }
        setReady(true);
      })
      .catch(() => {
        if (cancelled) return;
        setDenied(!legacyOk);
        setReady(true);
      });
    return () => { cancelled = true; };
  }, [pathname, router, requireAuth, loginPath, requiredBadge]);

  if (requireAuth && pathname === loginPath) return <>{children}</>;

  if (denied) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3"
        style={{ background: "var(--bg-deep, #060D1A)" }}>
        <span style={{ color: "var(--text-muted, #4A6A8A)" }}>
          Access denied — the {requiredBadge} badge is required.
        </span>
        <a href={storefrontHref} className="text-sm underline"
          style={{ color: "var(--text-muted, #4A6A8A)" }}>
          Back to storefront
        </a>
      </div>
    );
  }

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center"
        style={{ background: "var(--bg-deep, #060D1A)" }}>
        <span className="animate-pulse" style={{ color: "var(--text-muted, #4A6A8A)" }}>
          Loading…
        </span>
      </div>
    );
  }

  function handleLogout() {
    clearToken();
    clearStoredUser();
    onLogout?.();
    if (requireAuth) router.push(loginPath);
  }

  return (
    <div className="min-h-screen flex" style={{ background: "var(--bg-deep, #060D1A)" }}>
      {/* Sidebar */}
      <aside
        className="w-64 flex flex-col shrink-0"
        style={{
          background: "var(--bg-base, #0A1628)",
          borderRight: "1px solid var(--glass-border, rgba(26,42,64,0.8))",
        }}
      >
        <div className="p-6" style={{ borderBottom: "1px solid var(--glass-border, rgba(26,42,64,0.8))" }}>
          <div className="flex items-center gap-2 mb-1">
            <span
              className="text-lg font-light"
              style={{
                background: "var(--gradient-ai-symbol, linear-gradient(135deg, #00E5FF, #40C4FF))",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
              }}
            >
              {brandName}
            </span>
          </div>
          <p
            className="text-[10px] uppercase tracking-[0.22em]"
            style={{ color: "var(--text-ghost, #2A4A6A)" }}
          >
            Store Management
          </p>
        </div>

        <nav className="flex-1 py-4">
          {navItems.map((item) => {
            const Icon = item.icon || Box;
            const active =
              item.href === "/admin"
                ? pathname === "/admin"
                : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className="flex items-center gap-3 px-6 py-3 text-sm transition-colors"
                style={{
                  color: active
                    ? "var(--text-primary, #E8F0F8)"
                    : "var(--text-muted, #4A6A8A)",
                  background: active ? "var(--sidebar-row-active-bg, rgba(26,42,64,0.8))" : "transparent",
                }}
              >
                <Icon className="w-4 h-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="p-4" style={{ borderTop: "1px solid var(--glass-border, rgba(26,42,64,0.8))" }}>
          {user && (
            <div className="mb-3 px-2">
              <p className="text-sm" style={{ color: "var(--text-secondary, #8EACCD)" }}>
                {user.username}
              </p>
              <p className="text-[10px] uppercase tracking-wider" style={{ color: "var(--text-ghost, #2A4A6A)" }}>
                {user.role}
              </p>
            </div>
          )}
          {portalUrl && (
            <a
              href={portalUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 px-2 py-2 text-xs transition-colors"
              style={{ color: "var(--accent-primary, #00E5FF)" }}
            >
              <ExternalLink className="w-3.5 h-3.5" />
              Open Platform Portal
            </a>
          )}
          {requireAuth && (
            <button
              onClick={handleLogout}
              className="flex items-center gap-2 px-2 py-2 text-xs transition-colors"
              style={{ color: "var(--text-ghost, #2A4A6A)" }}
            >
              <LogOut className="w-3.5 h-3.5" />
              Sign out
            </button>
          )}
          <Link
            href={storefrontHref}
            className="flex items-center gap-2 px-2 py-2 mt-1 text-xs transition-colors"
            style={{ color: "var(--text-ghost, #2A4A6A)" }}
          >
            <ChevronLeft className="w-3.5 h-3.5" />
            Back to storefront
          </Link>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 min-h-screen overflow-auto">{children}</main>
    </div>
  );
}
