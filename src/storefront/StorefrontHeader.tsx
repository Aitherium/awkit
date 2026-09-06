'use client'

import { useEffect, useState } from 'react'
import { ShoppingBag, Moon, Sun, Shield, LayoutDashboard } from 'lucide-react'
import AudioControls from './AudioControls'
import type { AudioProfile } from './AudioTypes'
import { useStorefrontTheme } from './StorefrontThemeProvider'
import { useCart } from './CartProvider'

interface NavLink {
  label: string
  href: string
}

interface StorefrontHeaderProps {
  storeName: string
  logoSrc?: string
  links?: NavLink[]
  heroOverlay?: boolean
  showAudio?: boolean
  audioToggle?: () => void
  audioEnabled?: boolean
  audioProfile?: AudioProfile
  audioVolumes?: AudioProfile['volumes']
  onProfileChange?: (profile: AudioProfile) => void
  onVolumeChange?: (category: 'master' | 'ambient' | 'sfx' | 'accent', value: number) => void
  onCartClick?: () => void
  adminHref?: string
  adminLabel?: string
  workspaceHref?: string
  workspaceLabel?: string
  renderLink?: (props: { href: string; children: React.ReactNode; className?: string }) => React.ReactNode
}

const defaultLinks: NavLink[] = [
  { label: 'Home', href: '/' },
  { label: 'Shop', href: '/shop' },
  { label: 'About', href: '/about' },
]

export default function StorefrontHeader({
  storeName,
  logoSrc,
  links = defaultLinks,
  heroOverlay = false,
  showAudio = false,
  audioToggle,
  audioEnabled = false,
  audioProfile,
  audioVolumes,
  onProfileChange,
  onVolumeChange,
  onCartClick,
  adminHref,
  adminLabel = 'Manage Store',
  workspaceHref,
  workspaceLabel = 'Workspace',
  renderLink,
}: StorefrontHeaderProps) {
  const { isDark, toggleMode } = useStorefrontTheme()
  const { itemCount, toggleCart } = useCart()
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40)
    onScroll()
    window.addEventListener('scroll', onScroll)
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const solid = scrolled || !heroOverlay
  const tone = solid
    ? 'text-[var(--sf-text-secondary)]'
    : heroOverlay ? 'text-white' : 'text-[var(--sf-text-secondary)]'
  const logoTone = solid
    ? 'text-[var(--sf-text)]'
    : heroOverlay ? 'text-white' : 'text-[var(--sf-text)]'

  const Link = renderLink ?? (({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>{children}</a>
  ))

  return (
    <nav
      className={[
        'fixed inset-x-0 top-0 z-50 transition-all duration-500',
        solid
          ? 'border-b border-[var(--sf-border)] bg-[var(--sf-surface)] py-3 shadow-sm'
          : 'bg-transparent py-6',
      ].join(' ')}
    >
      <div className="mx-auto flex max-w-[1280px] items-center justify-between px-6">
        {/* Left: nav links */}
        <div className="hidden items-center gap-6 sm:flex">
          {links.map(l => (
            <Link key={l.href} href={l.href}>
              <span className={`text-[11px] uppercase tracking-[0.15em] transition-colors duration-300 hover:text-[var(--sf-primary)] ${tone}`}>
                {l.label}
              </span>
            </Link>
          ))}
        </div>

        {/* Center: logo / store name */}
        <Link href="/">
          <span
            className={`absolute left-1/2 -translate-x-1/2 whitespace-nowrap text-[22px] font-bold tracking-[0.06em] transition-colors duration-300 ${logoTone}`}
            style={{ fontFamily: 'var(--sf-font-display)' }}
          >
            {logoSrc ? <img src={logoSrc} alt={storeName} className="h-8" /> : storeName}
          </span>
        </Link>

        {/* Right: actions */}
        <div className="flex items-center gap-1">
          {workspaceHref && (
            <Link href={workspaceHref}>
              <span
                title={workspaceLabel}
                aria-label={workspaceLabel}
                className={`inline-flex rounded-lg p-2 transition-colors duration-200 hover:bg-[var(--sf-border)] ${tone}`}
              >
                <LayoutDashboard className="h-4 w-4" />
              </span>
            </Link>
          )}
          {adminHref && (
            <a
              href={adminHref}
              target="_blank"
              rel="noopener noreferrer"
              title={adminLabel}
              aria-label={adminLabel}
              className={`rounded-lg p-2 transition-colors duration-200 hover:bg-[var(--sf-border)] ${tone}`}
            >
              <Shield className="h-4 w-4" />
            </a>
          )}
          {showAudio && audioToggle && audioProfile && audioVolumes && onVolumeChange ? (
            <AudioControls
              enabled={audioEnabled}
              onToggle={audioToggle}
              volumes={audioVolumes}
              onVolumeChange={onVolumeChange}
              profileId={audioProfile.id}
              onProfileChange={onProfileChange}
              tone={tone}
            />
          ) : showAudio && audioToggle && (
            <AudioControls
              enabled={audioEnabled}
              onToggle={audioToggle}
              volumes={{ master: 0.7, ambient: 0.3, sfx: 0.5, accent: 0.2 }}
              onVolumeChange={() => {}}
              profileId="default"
              tone={tone}
            />
          )}
          <button
            onClick={toggleMode}
            aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            className={`rounded-lg p-2 transition-colors duration-200 hover:bg-[var(--sf-border)] ${tone}`}
          >
            {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
          <button
            onClick={onCartClick ?? toggleCart}
            aria-label="Shopping cart"
            className={`relative rounded-lg p-2 transition-colors duration-200 hover:bg-[var(--sf-border)] ${tone}`}
          >
            <ShoppingBag className="h-[18px] w-[18px]" />
            {itemCount > 0 && (
              <span className="absolute -right-1 -top-1 flex h-[18px] w-[18px] items-center justify-center rounded-full bg-[var(--sf-primary)] text-[10px] font-bold text-white">
                {itemCount}
              </span>
            )}
          </button>
        </div>
      </div>
    </nav>
  )
}
