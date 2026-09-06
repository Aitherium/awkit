'use client'

import { useCart } from './CartProvider'

interface CartDrawerProps {
  onCheckout: () => void
  checkoutLoading?: boolean
  checkoutError?: string | null
  onDismissError?: () => void
}

function formatPrice(amount: number, currency = 'usd'): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount / 100)
}

export default function CartDrawer({ onCheckout, checkoutLoading = false, checkoutError, onDismissError }: CartDrawerProps) {
  const { items, isOpen, subtotal, setCartOpen, removeItem, updateQuantity } = useCart()

  const isDemoError = checkoutError != null && (
    checkoutError.toLowerCase().includes('not configured') ||
    checkoutError.toLowerCase().includes('demo')
  )

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={() => setCartOpen(false)}
        className={`fixed inset-0 z-[998] bg-black/40 transition-opacity duration-300 ${
          isOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      />

      {/* Drawer */}
      <div
        className={`fixed bottom-0 right-0 top-0 z-[999] flex w-[400px] max-w-full flex-col border-l border-[var(--sf-border)] bg-[var(--sf-background)] transition-transform duration-300 ease-out ${
          isOpen ? 'translate-x-0 shadow-[-4px_0_20px_rgba(0,0,0,0.15)]' : 'translate-x-full'
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--sf-border)] px-6 py-5">
          <h2
            className="text-xl font-bold text-[var(--sf-text)]"
            style={{ fontFamily: 'var(--sf-font-display)' }}
          >
            Cart ({items.length})
          </h2>
          <button
            onClick={() => setCartOpen(false)}
            className="cursor-pointer border-none bg-transparent text-2xl text-[var(--sf-text-muted)] transition-colors duration-200 hover:text-[var(--sf-text)]"
          >
            {'\u2715'}
          </button>
        </div>

        {/* Items */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {items.length === 0 ? (
            <div className="py-12 text-center text-[var(--sf-text-muted)]">
              <svg className="mx-auto mb-4 h-12 w-12 opacity-30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z" />
                <line x1="3" y1="6" x2="21" y2="6" />
                <path d="M16 10a4 4 0 01-8 0" />
              </svg>
              <p>Your cart is empty</p>
            </div>
          ) : (
            items.map(item => (
              <div key={item.priceId} className="flex gap-4 border-b border-[var(--sf-border)] py-4">
                {/* Image */}
                <div className="h-[72px] w-[72px] flex-shrink-0 overflow-hidden rounded-[var(--sf-radius)] border border-[var(--sf-border)] bg-[var(--sf-surface)]">
                  {item.image ? (
                    <img src={item.image} alt={item.name} className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-[var(--sf-text-muted)]">
                      <svg className="h-6 w-6 opacity-40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z" />
                        <line x1="7" y1="7" x2="7.01" y2="7" />
                      </svg>
                    </div>
                  )}
                </div>

                {/* Info */}
                <div className="min-w-0 flex-1">
                  <p className="mb-1 truncate text-sm font-semibold text-[var(--sf-text)]">{item.name}</p>
                  {item.variant && (
                    <p className="mb-1.5 text-xs text-[var(--sf-text-muted)]">{item.variant}</p>
                  )}
                  <p className="text-[15px] font-medium text-[var(--sf-text)]">
                    {formatPrice(item.unitAmount, item.currency)}
                  </p>
                  <div className="mt-2 flex items-center gap-2">
                    <button
                      onClick={() => updateQuantity(item.priceId, item.quantity - 1)}
                      className="flex h-7 w-7 cursor-pointer items-center justify-center rounded border border-[var(--sf-border)] bg-[var(--sf-surface)] text-sm text-[var(--sf-text)] transition-colors hover:bg-[var(--sf-border)]"
                    >
                      -
                    </button>
                    <span className="min-w-[20px] text-center text-sm text-[var(--sf-text)]">{item.quantity}</span>
                    <button
                      onClick={() => updateQuantity(item.priceId, item.quantity + 1)}
                      className="flex h-7 w-7 cursor-pointer items-center justify-center rounded border border-[var(--sf-border)] bg-[var(--sf-surface)] text-sm text-[var(--sf-text)] transition-colors hover:bg-[var(--sf-border)]"
                    >
                      +
                    </button>
                    <button
                      onClick={() => removeItem(item.priceId)}
                      className="ml-auto cursor-pointer border-none bg-transparent text-xs text-[var(--sf-text-muted)] underline transition-colors hover:text-[var(--sf-secondary)]"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        {items.length > 0 && (
          <div className="border-t border-[var(--sf-border)] px-6 py-5">
            {/* Error display */}
            {checkoutError && (
              <div className={`mb-4 rounded-[var(--sf-radius)] border px-4 py-3 text-sm ${
                isDemoError
                  ? 'border-amber-500/30 bg-amber-500/10 text-amber-400'
                  : 'border-red-500/30 bg-red-500/10 text-red-400'
              }`}>
                <div className="flex items-start justify-between gap-2">
                  <p>{isDemoError ? 'Demo mode \u2014 checkout is disabled. Products shown for preview only.' : checkoutError}</p>
                  {onDismissError && (
                    <button onClick={onDismissError} className="flex-shrink-0 cursor-pointer border-none bg-transparent text-current opacity-60 hover:opacity-100">
                      {'\u2715'}
                    </button>
                  )}
                </div>
              </div>
            )}

            <div className="mb-4 flex justify-between">
              <span className="text-base text-[var(--sf-text-secondary)]">Subtotal</span>
              <span className="text-lg font-bold text-[var(--sf-text)]">{formatPrice(subtotal)}</span>
            </div>
            <p className="mb-4 text-xs text-[var(--sf-text-muted)]">
              Shipping and taxes calculated at checkout.
            </p>
            <button
              onClick={onCheckout}
              disabled={checkoutLoading || isDemoError}
              className={`w-full cursor-pointer rounded-[var(--sf-radius)] border-none bg-[var(--sf-primary)] px-6 py-3.5 text-[15px] font-semibold uppercase tracking-[0.06em] text-white transition-opacity duration-200 ${
                checkoutLoading || isDemoError ? 'cursor-not-allowed opacity-60' : 'hover:opacity-90'
              }`}
            >
              {checkoutLoading ? 'Redirecting...' : isDemoError ? 'Demo Mode' : 'Checkout'}
            </button>
          </div>
        )}
      </div>
    </>
  )
}
