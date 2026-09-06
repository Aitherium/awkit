'use client'

import { useState } from 'react'
import { useCart } from './CartProvider'

interface ProductPrice {
  id: string
  unitAmount: number
  currency: string
  nickname?: string
}

interface ProductDetailProduct {
  id: string
  name: string
  description?: string
  images: string[]
  prices: ProductPrice[]
  category?: string
  metadata?: Record<string, string>
}

interface ProductDetailProps {
  product: ProductDetailProduct
  features?: string[]
  renderLink?: (props: { href: string; children: React.ReactNode; className?: string }) => React.ReactNode
}

function formatPrice(amount: number, currency = 'usd'): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount / 100)
}

export default function ProductDetail({ product, features, renderLink }: ProductDetailProps) {
  const { addItem } = useCart()
  const [selectedPrice, setSelectedPrice] = useState(product.prices[0]?.id ?? '')
  const [quantity, setQuantity] = useState(1)
  const [imageIdx, setImageIdx] = useState(0)

  const price = product.prices.find(p => p.id === selectedPrice) ?? product.prices[0]

  const Link = renderLink ?? (({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>{children}</a>
  ))

  const handleAdd = () => {
    if (!price) return
    addItem({
      priceId: price.id,
      productId: product.id,
      name: product.name + (price.nickname ? ` - ${price.nickname}` : ''),
      image: product.images[0],
      unitAmount: price.unitAmount,
      currency: price.currency,
      variant: price.nickname,
    }, quantity)
  }

  return (
    <div className="mx-auto max-w-[1200px] px-6">
      {/* Breadcrumb */}
      <nav className="mb-8 text-sm text-[var(--sf-text-muted)]">
        <Link href="/shop">
          <span className="transition-colors duration-200 hover:text-[var(--sf-primary)]">Shop</span>
        </Link>
        <span className="mx-2">/</span>
        <span className="text-[var(--sf-text)]">{product.name}</span>
      </nav>

      <div className="grid grid-cols-1 items-start gap-16 md:grid-cols-2">
        {/* Image gallery */}
        <div>
          <div className="aspect-square overflow-hidden rounded-[var(--sf-radius)] border border-[var(--sf-border)] bg-[var(--sf-surface)]">
            {product.images[imageIdx] ? (
              <img src={product.images[imageIdx]} alt={product.name} className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-[var(--sf-text-muted)]">
                <svg className="h-24 w-24 opacity-20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z" />
                  <line x1="7" y1="7" x2="7.01" y2="7" />
                </svg>
              </div>
            )}
          </div>
          {product.images.length > 1 && (
            <div className="mt-3 flex gap-2">
              {product.images.map((img, i) => (
                <button
                  key={i}
                  onClick={() => setImageIdx(i)}
                  className={`h-16 w-16 overflow-hidden rounded-[var(--sf-radius)] bg-[var(--sf-surface)] p-0 ${
                    i === imageIdx ? 'border-2 border-[var(--sf-primary)]' : 'border border-[var(--sf-border)]'
                  }`}
                >
                  <img src={img} alt="" className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Product info */}
        <div>
          {product.category && (
            <p className="mb-2 text-[11px] uppercase tracking-[0.25em] text-[var(--sf-text-muted)]">
              {product.category}
            </p>
          )}
          <h1
            className="mb-3 text-[32px] font-bold leading-tight text-[var(--sf-text)]"
            style={{ fontFamily: 'var(--sf-font-display)' }}
          >
            {product.name}
          </h1>
          {price && (
            <p className="mb-6 text-2xl text-[var(--sf-text)]">
              {formatPrice(price.unitAmount, price.currency)}
            </p>
          )}

          {product.description && (
            <div className="mb-6 border-t border-[var(--sf-border)] pt-5">
              <p className="text-[15px] leading-[1.7] text-[var(--sf-text-secondary)]">
                {product.description}
              </p>
            </div>
          )}

          {/* Variant selector */}
          {product.prices.length > 1 && (
            <div className="mb-5">
              <p className="mb-2 text-[13px] text-[var(--sf-text-secondary)]">Size / Variant</p>
              <div className="flex flex-wrap gap-2">
                {product.prices.map(p => (
                  <button
                    key={p.id}
                    onClick={() => setSelectedPrice(p.id)}
                    className={`cursor-pointer rounded-[var(--sf-radius)] px-4 py-2 text-sm text-[var(--sf-text)] transition-all duration-200 ${
                      p.id === selectedPrice
                        ? 'border-2 border-[var(--sf-primary)]'
                        : 'border border-[var(--sf-border)] bg-[var(--sf-surface)] hover:border-[var(--sf-primary)]'
                    }`}
                  >
                    {p.nickname || formatPrice(p.unitAmount, p.currency)}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Quantity + Add to cart */}
          <div className="mb-6 flex gap-3">
            <div className="flex overflow-hidden rounded-[var(--sf-radius)] border border-[var(--sf-border)]">
              <button
                onClick={() => setQuantity(Math.max(1, quantity - 1))}
                className="w-10 cursor-pointer border-none bg-[var(--sf-surface)] text-lg text-[var(--sf-text)] transition-colors hover:bg-[var(--sf-border)]"
              >
                -
              </button>
              <span className="flex w-12 items-center justify-center text-[15px] text-[var(--sf-text)]">
                {quantity}
              </span>
              <button
                onClick={() => setQuantity(quantity + 1)}
                className="w-10 cursor-pointer border-none bg-[var(--sf-surface)] text-lg text-[var(--sf-text)] transition-colors hover:bg-[var(--sf-border)]"
              >
                +
              </button>
            </div>
            <button
              onClick={handleAdd}
              className="flex-1 cursor-pointer rounded-[var(--sf-radius)] border-none bg-[var(--sf-primary)] px-6 py-3 text-sm font-semibold uppercase tracking-[0.08em] text-white transition-opacity duration-200 hover:opacity-90"
            >
              Add to Cart
            </button>
          </div>

          {/* Features */}
          {features && features.length > 0 && (
            <div className="border-t border-[var(--sf-border)] pt-5">
              {features.map((f, i) => (
                <div key={i} className="mb-2.5 flex items-start gap-2.5 text-sm text-[var(--sf-text-secondary)]">
                  <span className="text-[var(--sf-accent)]">{'\u2713'}</span>
                  <span>{f}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
