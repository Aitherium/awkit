'use client'

export interface ProductCardProduct {
  id: string
  name: string
  slug: string
  description?: string
  images: string[]
  price: number
  currency?: string
  category?: string
  variant?: string
  inStock?: boolean
}

interface ProductCardProps {
  product: ProductCardProduct
  index?: number
  renderLink?: (props: { href: string; children: React.ReactNode; className?: string }) => React.ReactNode
}

function formatPrice(amount: number, currency = 'usd'): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount / 100)
}

export default function ProductCard({ product, index = 0, renderLink }: ProductCardProps) {
  const Link = renderLink ?? (({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>{children}</a>
  ))

  const image = product.images[0]
  const inStock = product.inStock !== false

  return (
    <Link href={`/shop/${product.slug}`} className="block">
      <div
        className="group cursor-pointer opacity-0 translate-y-5 animate-[sfFadeIn_0.6s_forwards]"
        style={{ animationDelay: `${index * 0.1}s` }}
      >
        <div className="mb-4 aspect-square overflow-hidden rounded-[var(--sf-radius)] border border-[var(--sf-border)] bg-[var(--sf-surface)] transition-all duration-300 group-hover:border-[var(--sf-primary)] group-hover:ring-1 group-hover:ring-[var(--sf-primary)]">
          {image ? (
            <img
              src={image}
              alt={product.name}
              loading="lazy"
              className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-[1.08]"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-[var(--sf-text-muted)]">
              <svg className="h-16 w-16 opacity-30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z" />
                <line x1="7" y1="7" x2="7.01" y2="7" />
              </svg>
            </div>
          )}
        </div>
        <div className="text-center">
          <h4
            className="mb-1 text-lg font-semibold text-[var(--sf-text)] transition-colors duration-200 group-hover:text-[var(--sf-primary)]"
            style={{ fontFamily: 'var(--sf-font-display)' }}
          >
            {product.name}
          </h4>
          {product.category && (
            <p className="mb-1 text-[11px] uppercase tracking-[0.2em] text-[var(--sf-text-muted)]">
              {product.category}
            </p>
          )}
          <p className="text-base text-[var(--sf-text-secondary)]">
            {product.price > 0 ? formatPrice(product.price, product.currency) : 'Price on request'}
          </p>
          {!inStock && (
            <p className="mt-1 text-xs italic text-[var(--sf-secondary)]">
              Currently unavailable
            </p>
          )}
        </div>
      </div>
    </Link>
  )
}
