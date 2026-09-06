"use client";

import { useEffect, useState } from "react";
import {
  AlertTriangle,
  BarChart3,
  DollarSign,
  Package,
  ShoppingCart,
} from "lucide-react";
import { adminFetch, normalizeProduct, type DashboardStats, type Order, type Product } from "./AdminAPI";

export interface AdminDashboardProps {
  apiBase?: string;
}

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  sub?: string;
}) {
  return (
    <div
      className="rounded-2xl p-6"
      style={{
        background: "var(--bg-surface, #0A1628)",
        border: "1px solid var(--glass-border, rgba(26,42,64,0.8))",
      }}
    >
      <div className="flex items-center gap-3 mb-3">
        <div
          className="rounded-xl p-2.5"
          style={{ background: "var(--bg-elevated, #1A2A40)", color: "var(--accent-primary, #00E5FF)" }}
        >
          <Icon className="w-5 h-5" />
        </div>
        <span
          className="text-xs uppercase tracking-[0.22em]"
          style={{ color: "var(--text-ghost, #2A4A6A)" }}
        >
          {label}
        </span>
      </div>
      <p className="text-3xl font-light" style={{ color: "var(--text-primary, #E8F0F8)" }}>
        {value}
      </p>
      {sub && (
        <p className="text-xs mt-1" style={{ color: "var(--text-muted, #4A6A8A)" }}>
          {sub}
        </p>
      )}
    </div>
  );
}

export default function AdminDashboard({ apiBase = "/api/shop" }: AdminDashboardProps) {
  const [data, setData] = useState<DashboardStats | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [recentOrders, setRecentOrders] = useState<Order[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        // Try combined dashboard endpoint first, fall back to individual
        let stats: DashboardStats;
        try {
          stats = await adminFetch<DashboardStats>(apiBase, "/dashboard");
        } catch {
          // Fall back to /stats endpoint
          const raw = await adminFetch<{ active_products: number; total_orders: number; total_revenue_cents: number }>(
            apiBase, "/stats",
          );
          stats = {
            active_products: raw.active_products,
            total_orders: raw.total_orders,
            total_revenue: raw.total_revenue_cents ? raw.total_revenue_cents / 100 : 0,
          };
        }
        setData(stats);

        // Load products
        try {
          const pRes = await adminFetch<{ products?: Product[] } | Product[]>(apiBase, "/products");
          const pRaw = Array.isArray(pRes) ? pRes : (pRes.products || []);
          setProducts(pRaw.map((p) => normalizeProduct(p)));
        } catch { /* optional */ }

        // Load orders
        try {
          const oRes = await adminFetch<{ orders?: Order[] } | Order[]>(apiBase, "/orders");
          const oList = Array.isArray(oRes) ? oRes : (oRes.orders || []);
          setRecentOrders(oList.slice(0, 8));
        } catch { /* optional */ }
      } catch {
        setError("Failed to load dashboard data");
      }
    }
    load();
  }, [apiBase]);

  if (error) {
    return (
      <div className="p-8">
        <div className="rounded-xl px-5 py-4" style={{ background: "rgba(248,113,113,0.1)", color: "var(--accent-danger, #f87171)" }}>
          {error}
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="p-8 flex items-center gap-3">
        <span className="animate-pulse" style={{ color: "var(--text-muted, #4A6A8A)" }}>
          Loading dashboard…
        </span>
      </div>
    );
  }

  const revenue = data.total_revenue_cents
    ? data.total_revenue_cents / 100
    : (data.total_revenue ?? 0);

  const alertCount = data.alerts
    ? data.alerts.products.length + (data.alerts.supplies?.length ?? 0)
    : 0;

  return (
    <div className="p-8 max-w-7xl">
      <div className="mb-8">
        <h1 className="text-3xl font-light mb-1" style={{ color: "var(--text-primary, #E8F0F8)" }}>
          Dashboard
        </h1>
        <p className="text-sm font-light" style={{ color: "var(--text-muted, #4A6A8A)" }}>
          Store overview and quick stats
        </p>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 mb-8">
        <StatCard
          icon={Package}
          label="Products"
          value={data.active_products ?? products.length}
          sub={`${products.filter((p) => p.quantity_on_hand > 0).length} in stock`}
        />
        <StatCard
          icon={DollarSign}
          label="Revenue"
          value={`$${revenue.toFixed(2)}`}
          sub={`${data.total_orders} orders`}
        />
        <StatCard
          icon={ShoppingCart}
          label="Avg Order"
          value={`$${(data.avg_order_value ?? (data.total_orders ? revenue / data.total_orders : 0)).toFixed(2)}`}
          sub="Per transaction"
        />
        <StatCard
          icon={AlertTriangle}
          label="Alerts"
          value={alertCount}
          sub={alertCount === 0 ? "All healthy" : "Items need attention"}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Low Stock Alerts */}
        {data.alerts && alertCount > 0 && (
          <div
            className="rounded-2xl p-6"
            style={{
              background: "var(--bg-surface, #0A1628)",
              border: "1px solid var(--glass-border, rgba(26,42,64,0.8))",
            }}
          >
            <div className="flex items-center gap-2 mb-5">
              <AlertTriangle className="w-4 h-4" style={{ color: "var(--accent-warn, #f59e0b)" }} />
              <h2 className="text-xl font-light" style={{ color: "var(--text-primary, #E8F0F8)" }}>
                Low Stock Alerts
              </h2>
              <span
                className="ml-auto inline-flex items-center justify-center w-6 h-6 rounded-full text-xs text-white"
                style={{ background: "var(--accent-warn, #f59e0b)" }}
              >
                {alertCount}
              </span>
            </div>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {data.alerts.products.map((a, i) => (
                <div
                  key={`p-${i}`}
                  className="flex items-center justify-between px-3 py-2 rounded-lg text-sm"
                  style={{ background: "var(--bg-elevated, #1A2A40)" }}
                >
                  <span style={{ color: "var(--text-secondary, #8EACCD)" }}>
                    <Package className="w-3.5 h-3.5 inline mr-2" style={{ color: "var(--accent-warn, #f59e0b)" }} />
                    {a.product}
                  </span>
                  <span className="text-xs font-medium" style={{ color: "var(--accent-warn, #f59e0b)" }}>
                    {a.quantity} / {a.threshold}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Recent Orders */}
        <div
          className="rounded-2xl p-6"
          style={{
            background: "var(--bg-surface, #0A1628)",
            border: "1px solid var(--glass-border, rgba(26,42,64,0.8))",
          }}
        >
          <div className="flex items-center gap-2 mb-5">
            <BarChart3 className="w-4 h-4" style={{ color: "var(--accent-primary, #00E5FF)" }} />
            <h2 className="text-xl font-light" style={{ color: "var(--text-primary, #E8F0F8)" }}>
              Recent Orders
            </h2>
          </div>
          {recentOrders.length === 0 ? (
            <p className="text-sm" style={{ color: "var(--text-muted, #4A6A8A)" }}>
              No orders recorded yet
            </p>
          ) : (
            <div className="space-y-2">
              {recentOrders.map((o) => (
                <div
                  key={o.id}
                  className="flex items-center justify-between px-3 py-2 rounded-lg text-sm"
                  style={{ background: "var(--bg-elevated, #1A2A40)" }}
                >
                  <span style={{ color: "var(--text-secondary, #8EACCD)" }}>
                    {o.order_number ? `#${o.order_number}` : `Order #${o.id}`}
                  </span>
                  <div className="flex items-center gap-3">
                    <span className="text-xs" style={{ color: "var(--text-muted, #4A6A8A)" }}>
                      {o.date || o.created_at}
                    </span>
                    <span
                      className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full"
                      style={{
                        background: o.is_refunded || o.status === "refunded"
                          ? "rgba(248,113,113,0.15)"
                          : "rgba(74,222,128,0.15)",
                        color: o.is_refunded || o.status === "refunded"
                          ? "var(--accent-danger, #f87171)"
                          : "var(--accent-success, #4ade80)",
                      }}
                    >
                      {o.is_refunded ? "Refunded" : (o.status || o.payment_method || "Completed")}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Inventory snapshot */}
      {products.length > 0 && (
        <div
          className="mt-6 rounded-2xl p-6"
          style={{
            background: "var(--bg-surface, #0A1628)",
            border: "1px solid var(--glass-border, rgba(26,42,64,0.8))",
          }}
        >
          <h2 className="text-xl font-light mb-4" style={{ color: "var(--text-primary, #E8F0F8)" }}>
            Inventory Snapshot
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: "1px solid var(--glass-border, rgba(26,42,64,0.8))" }}>
                  {["Product", "SKU", "Price", "Stock", "Status"].map((h) => (
                    <th
                      key={h}
                      className={`text-[10px] uppercase tracking-[0.22em] py-3 pr-4 ${h === "Price" || h === "Stock" || h === "Status" ? "text-right" : "text-left"}`}
                      style={{ color: "var(--text-ghost, #2A4A6A)" }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {products.slice(0, 10).map((p) => {
                  const low = p.quantity_on_hand <= p.low_stock_threshold && p.low_stock_threshold > 0;
                  const price = p.retail_price ? `$${Number(p.retail_price).toFixed(2)}` : (p.price || "—");
                  return (
                    <tr
                      key={p.id}
                      className="transition-colors"
                      style={{ borderBottom: "1px solid var(--bg-elevated, #1A2A40)" }}
                    >
                      <td className="py-3 pr-4" style={{ color: "var(--text-secondary, #8EACCD)" }}>
                        {p.name}
                        {p.variant && (
                          <span className="ml-1" style={{ color: "var(--text-muted, #4A6A8A)" }}>
                            – {p.variant}
                          </span>
                        )}
                      </td>
                      <td className="py-3 pr-4 text-xs font-mono" style={{ color: "var(--text-muted, #4A6A8A)" }}>
                        {p.sku}
                      </td>
                      <td className="py-3 pr-4 text-right" style={{ color: "var(--text-secondary, #8EACCD)" }}>
                        {price}
                      </td>
                      <td className="py-3 pr-4 text-right" style={{ color: "var(--text-secondary, #8EACCD)" }}>
                        {p.quantity_on_hand}
                      </td>
                      <td className="py-3 text-right">
                        <span
                          className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full"
                          style={{
                            background: low
                              ? "rgba(245,158,11,0.15)"
                              : p.quantity_on_hand === 0
                                ? "rgba(248,113,113,0.15)"
                                : "rgba(74,222,128,0.15)",
                            color: low
                              ? "var(--accent-warn, #f59e0b)"
                              : p.quantity_on_hand === 0
                                ? "var(--accent-danger, #f87171)"
                                : "var(--accent-success, #4ade80)",
                          }}
                        >
                          {p.quantity_on_hand === 0 ? "Out" : low ? "Low" : (p.status === "active" ? "Active" : "Good")}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
