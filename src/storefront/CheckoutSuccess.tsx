'use client'

import { useEffect, useState } from 'react'
import { CheckCircle } from 'lucide-react'

interface OrderInfo {
  customerEmail?: string
  amountTotal?: number
  currency?: string
  paymentStatus?: string
}

interface CheckoutSuccessProps {
  sessionId: string | null
  apiBase?: string
  onContinueShopping?: () => void
  renderLink?: (props: { href: string; children: React.ReactNode; className?: string }) => React.ReactNode
}

function formatPrice(amount: number, currency = 'usd'): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount / 100)
}

export default function CheckoutSuccess({ sessionId, apiBase = '/api', onContinueShopping, renderLink }: CheckoutSuccessProps) {
  const [order, setOrder] = useState<OrderInfo | null>(null)
  const [loading, setLoading] = useState(!!sessionId)

  const Link = renderLink ?? (({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>{children}</a>
  ))

  useEffect(() => {
    if (!sessionId) return
    fetch(`${apiBase}/checkout/session?id=${encodeURIComponent(sessionId)}`)
      .then(r => r.json())
      .then(data => setOrder(data))
      .catch(() => setOrder(null))
      .finally(() => setLoading(false))
  }, [sessionId, apiBase])

  return (
    <div className="mx-auto max-w-[600px] px-6 py-20 text-center">
      <div className="rounded-[var(--sf-radius)] border border-[var(--sf-border)] bg-[var(--sf-surface)] px-8 py-12">
        <div className="mb-4 flex justify-center text-[var(--sf-accent)]">
          <CheckCircle className="h-14 w-14" />
        </div>
        <h1
          className="mb-3 text-[28px] font-bold text-[var(--sf-text)]"
          style={{ fontFamily: 'var(--sf-font-display)' }}
        >
          Thank you for your order!
        </h1>

        {loading ? (
          <p className="text-[var(--sf-text-muted)]">Loading order details...</p>
        ) : order ? (
          <div className="mt-6 text-left">
            {order.customerEmail && (
              <div className="flex justify-between border-b border-[var(--sf-border)] py-3">
                <span className="text-sm text-[var(--sf-text-secondary)]">Email</span>
                <span className="text-sm text-[var(--sf-text)]">{order.customerEmail}</span>
              </div>
            )}
            {order.amountTotal != null && (
              <div className="flex justify-between border-b border-[var(--sf-border)] py-3">
                <span className="text-sm text-[var(--sf-text-secondary)]">Total</span>
                <span className="text-sm font-semibold text-[var(--sf-text)]">
                  {formatPrice(order.amountTotal, order.currency)}
                </span>
              </div>
            )}
            {order.paymentStatus && (
              <div className="flex justify-between py-3">
                <span className="text-sm text-[var(--sf-text-secondary)]">Status</span>
                <span className="rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-semibold text-emerald-400">
                  {order.paymentStatus}
                </span>
              </div>
            )}
          </div>
        ) : (
          <p className="mt-3 text-[var(--sf-text-secondary)]">
            A confirmation email has been sent.
          </p>
        )}

        <div className="mt-8">
          {onContinueShopping ? (
            <button
              onClick={onContinueShopping}
              className="cursor-pointer rounded-[var(--sf-radius)] border border-[var(--sf-primary)] bg-transparent px-8 py-3 text-sm font-semibold text-[var(--sf-primary)] transition-all duration-200 hover:bg-[var(--sf-primary)] hover:text-white"
            >
              Continue Shopping
            </button>
          ) : (
            <Link href="/shop">
              <span className="inline-block rounded-[var(--sf-radius)] border border-[var(--sf-primary)] px-8 py-3 text-sm font-semibold text-[var(--sf-primary)] transition-all duration-200 hover:bg-[var(--sf-primary)] hover:text-white">
                Continue Shopping
              </span>
            </Link>
          )}
        </div>
      </div>
    </div>
  )
}
