'use client'

import { createContext, useContext, useReducer, useEffect, useCallback, useMemo } from 'react'

export interface CartItem {
  priceId: string
  productId: string
  name: string
  image?: string
  unitAmount: number
  currency: string
  quantity: number
  variant?: string
}

interface CartState {
  items: CartItem[]
  isOpen: boolean
}

type CartAction =
  | { type: 'ADD'; item: Omit<CartItem, 'quantity'>; quantity?: number }
  | { type: 'REMOVE'; priceId: string }
  | { type: 'UPDATE_QTY'; priceId: string; quantity: number }
  | { type: 'CLEAR' }
  | { type: 'TOGGLE' }
  | { type: 'SET_OPEN'; open: boolean }
  | { type: 'HYDRATE'; items: CartItem[] }

function cartReducer(state: CartState, action: CartAction): CartState {
  switch (action.type) {
    case 'ADD': {
      const qty = action.quantity ?? 1
      const existing = state.items.find(i => i.priceId === action.item.priceId)
      if (existing) {
        return {
          ...state,
          isOpen: true,
          items: state.items.map(i =>
            i.priceId === action.item.priceId
              ? { ...i, quantity: i.quantity + qty }
              : i
          ),
        }
      }
      return { ...state, isOpen: true, items: [...state.items, { ...action.item, quantity: qty }] }
    }
    case 'REMOVE':
      return { ...state, items: state.items.filter(i => i.priceId !== action.priceId) }
    case 'UPDATE_QTY':
      if (action.quantity <= 0) {
        return { ...state, items: state.items.filter(i => i.priceId !== action.priceId) }
      }
      return {
        ...state,
        items: state.items.map(i =>
          i.priceId === action.priceId ? { ...i, quantity: action.quantity } : i
        ),
      }
    case 'CLEAR':
      return { ...state, items: [] }
    case 'TOGGLE':
      return { ...state, isOpen: !state.isOpen }
    case 'SET_OPEN':
      return { ...state, isOpen: action.open }
    case 'HYDRATE':
      return { ...state, items: action.items }
    default:
      return state
  }
}

interface CartContextValue {
  items: CartItem[]
  isOpen: boolean
  itemCount: number
  subtotal: number
  addItem: (item: Omit<CartItem, 'quantity'>, quantity?: number) => void
  removeItem: (priceId: string) => void
  updateQuantity: (priceId: string, quantity: number) => void
  clearCart: () => void
  toggleCart: () => void
  setCartOpen: (open: boolean) => void
}

const CartContext = createContext<CartContextValue | null>(null)

const STORAGE_KEY = 'sf-cart'

export function CartProvider({ children, storageKey }: { children: React.ReactNode; storageKey?: string }) {
  const key = storageKey ?? STORAGE_KEY
  const [state, dispatch] = useReducer(cartReducer, { items: [], isOpen: false })

  useEffect(() => {
    try {
      const raw = localStorage.getItem(key)
      if (raw) {
        const items = JSON.parse(raw)
        if (Array.isArray(items)) dispatch({ type: 'HYDRATE', items })
      }
    } catch { /* ignore corrupt storage */ }
  }, [key])

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(state.items))
    } catch { /* quota exceeded, ignore */ }
  }, [state.items, key])

  const addItem = useCallback((item: Omit<CartItem, 'quantity'>, quantity?: number) => {
    dispatch({ type: 'ADD', item, quantity })
  }, [])
  const removeItem = useCallback((priceId: string) => dispatch({ type: 'REMOVE', priceId }), [])
  const updateQuantity = useCallback((priceId: string, quantity: number) => {
    dispatch({ type: 'UPDATE_QTY', priceId, quantity })
  }, [])
  const clearCart = useCallback(() => dispatch({ type: 'CLEAR' }), [])
  const toggleCart = useCallback(() => dispatch({ type: 'TOGGLE' }), [])
  const setCartOpen = useCallback((open: boolean) => dispatch({ type: 'SET_OPEN', open }), [])

  const itemCount = state.items.reduce((sum, i) => sum + i.quantity, 0)
  const subtotal = state.items.reduce((sum, i) => sum + i.unitAmount * i.quantity, 0)

  const value = useMemo(() => ({
    items: state.items, isOpen: state.isOpen, itemCount, subtotal,
    addItem, removeItem, updateQuantity, clearCart, toggleCart, setCartOpen,
  }), [state.items, state.isOpen, itemCount, subtotal, addItem, removeItem, updateQuantity, clearCart, toggleCart, setCartOpen])

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>
}

export function useCart() {
  const ctx = useContext(CartContext)
  if (!ctx) throw new Error('useCart must be used within CartProvider')
  return ctx
}
