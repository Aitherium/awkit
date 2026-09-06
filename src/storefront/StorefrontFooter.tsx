'use client'

interface FooterLink {
  label: string
  href: string
}

interface FooterColumn {
  title: string
  links: FooterLink[]
}

interface StorefrontFooterProps {
  storeName: string
  tagline?: string
  columns?: FooterColumn[]
  copyright?: string
  renderLink?: (props: { href: string; children: React.ReactNode; className?: string }) => React.ReactNode
}

const defaultColumns: FooterColumn[] = [
  {
    title: 'Shop',
    links: [
      { label: 'All Products', href: '/shop' },
      { label: 'New Arrivals', href: '/shop?sort=newest' },
    ],
  },
  {
    title: 'Company',
    links: [
      { label: 'About', href: '/about' },
      { label: 'Contact', href: '/contact' },
    ],
  },
]

export default function StorefrontFooter({
  storeName,
  tagline,
  columns = defaultColumns,
  copyright,
  renderLink,
}: StorefrontFooterProps) {
  const Link = renderLink ?? (({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>{children}</a>
  ))

  const year = new Date().getFullYear()

  return (
    <footer className="mt-20 border-t border-[var(--sf-border)] bg-[var(--sf-surface)] pb-8 pt-16">
      <div className="mx-auto max-w-[1280px] px-6">
        <div className="mb-12 grid grid-cols-1 gap-12 sm:grid-cols-2 lg:grid-cols-4">
          {/* Brand column */}
          <div className="sm:col-span-2 lg:col-span-1">
            <h2
              className="mb-3 text-2xl font-bold text-[var(--sf-text)]"
              style={{ fontFamily: 'var(--sf-font-display)' }}
            >
              {storeName}
            </h2>
            {tagline && (
              <p className="max-w-[300px] text-sm leading-relaxed text-[var(--sf-text-muted)]">
                {tagline}
              </p>
            )}
          </div>

          {/* Link columns */}
          {columns.map(col => (
            <div key={col.title}>
              <p className="mb-4 text-[11px] uppercase tracking-[0.2em] text-[var(--sf-text-muted)]">
                {col.title}
              </p>
              <div className="flex flex-col gap-2">
                {col.links.map(l => (
                  <Link key={l.href} href={l.href}>
                    <span className="text-sm text-[var(--sf-text-secondary)] transition-colors duration-200 hover:text-[var(--sf-primary)]">
                      {l.label}
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="border-t border-[var(--sf-border)] pt-6 text-center text-xs tracking-[0.1em] text-[var(--sf-text-muted)]">
          {copyright ?? `\u00A9 ${year} ${storeName}. All rights reserved.`}
        </div>
      </div>
    </footer>
  )
}
