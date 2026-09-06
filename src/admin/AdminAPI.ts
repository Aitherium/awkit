"use client";

/**
 * Generic admin API client for portal-kit admin components.
 * Configurable `apiBase` so any app (shop, tenant, tenant agent) can point it
 * at their own backend proxy route.
 */

const TOKEN_KEY = "pk_admin_token";
const USER_KEY = "pk_admin_user";

/* ── Auth token management ─────────────────────────────── */

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

export function getStoredUser(): { username: string; role: string } | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(USER_KEY);
  return raw ? JSON.parse(raw) : null;
}

export function setStoredUser(user: { username: string; role: string }) {
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearStoredUser() {
  localStorage.removeItem(USER_KEY);
}

/* ── Generic fetch ──────────────────────────────────────── */

export async function adminFetch<T>(
  apiBase: string,
  path: string,
  options?: RequestInit & { noAuth?: boolean },
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options?.headers as Record<string, string>),
  };

  if (!options?.noAuth) {
    const token = getToken();
    if (token) headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(`${apiBase}${path}`, { ...options, headers });

  if (res.status === 401) {
    clearToken();
    clearStoredUser();
    throw new Error("Unauthorized");
  }

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API ${res.status}: ${body}`);
  }

  if (res.status === 204) return undefined as unknown as T;
  return res.json();
}

/* ── Shared types ──────────────────────────────────────── */

export interface Product {
  id: number | string;
  sku: string;
  name: string;
  slug?: string;
  description?: string;
  variant?: string | null;
  category_id?: number;
  category?: string | { id: number; name: string } | null;
  retail_price?: number;
  price?: string;
  price_cents?: number;
  taxable?: boolean;
  quantity_on_hand: number;
  stock_quantity?: number | null;
  low_stock_threshold: number;
  status?: string;
  image_asset?: string;
  image_url?: string;
  stripe_product_id?: string;
}

export interface ProductCreate {
  sku: string;
  name: string;
  variant?: string;
  category_id?: number;
  retail_price?: number;
  price?: string;
  taxable?: boolean;
  quantity_on_hand?: number;
  low_stock_threshold?: number;
}

export interface Order {
  id: number | string;
  order_number?: string;
  date?: string;
  created_at?: string;
  payment_method?: string;
  discount?: number;
  customer_email?: string;
  customer_id?: number | null;
  notes?: string | null;
  is_refunded?: boolean;
  status?: string;
  total?: string;
  line_items: {
    id?: number;
    product_id?: number | string;
    quantity: number;
    unit_price: number;
  }[];
}

export interface Customer {
  id: number | string;
  name: string;
  email: string | null;
  phone: string | null;
  notes: string | null;
}

export interface CustomerCreate {
  name: string;
  email?: string;
  phone?: string;
  notes?: string;
}

export interface DashboardStats {
  active_products: number;
  total_orders: number;
  total_revenue: number;
  total_revenue_cents?: number;
  avg_order_value?: number;
  alerts?: {
    products: { product: string; quantity: number; threshold: number; deficit: number }[];
    supplies?: { supply: string; quantity: number; threshold: number; deficit: number }[];
  };
  recent_orders?: Order[];
}

export interface BlogPost {
  id: number;
  slug: string;
  title: string;
  excerpt: string;
  content: string;
  category: string;
  cover_image: string;
  read_time: string;
  published: boolean;
  sort_order: number;
  author: string | null;
  meta_description: string | null;
  tags: string | null;
  created_at: string;
  updated_at: string;
}

export interface BlogPostCreate {
  slug: string;
  title: string;
  excerpt?: string;
  content?: string;
  category?: string;
  cover_image?: string;
  read_time?: string;
  published?: boolean;
  sort_order?: number;
  author?: string;
  meta_description?: string;
  tags?: string;
}

/**
 * Normalize a product from different backend shapes.
 * Handles both tenant-style (quantity_on_hand) and shop-admin-style (stock_quantity).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function normalizeProduct(raw: any): Product {
  return {
    ...raw,
    sku: raw.sku || raw.slug || "",
    quantity_on_hand: raw.quantity_on_hand ?? raw.stock_quantity ?? 0,
    low_stock_threshold: raw.low_stock_threshold ?? 5,
  } as Product;
}

export interface SalesSummary {
  total_revenue: number;
  total_orders: number;
  avg_order_value: number;
  top_products_by_quantity?: { name: string; units: number; revenue: number }[];
  top_products_by_revenue?: { name: string; units: number; revenue: number }[];
}

export interface LowStockReport {
  products: { product: string; quantity: number; threshold: number; deficit: number }[];
  supplies?: { supply: string; quantity: number; threshold: number; deficit: number }[];
}
