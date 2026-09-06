"use client";

import { useEffect, useState, useCallback } from "react";
import { ShoppingCart, DollarSign, CreditCard, RefreshCcw } from "lucide-react";
import { adminFetch, type Order } from "./AdminAPI";

export interface OrderManagerProps {
  apiBase?: string;
}

export default function OrderManager({ apiBase = "/api/shop" }: OrderManagerProps) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminFetch<{ orders?: Order[] } | Order[]>(apiBase, "/orders");
      const list = Array.isArray(res) ? res : (res.orders || []);
      setOrders(list);
    } catch {
      setError("Failed to load orders");
    } finally {
      setLoading(false);
    }
  }, [apiBase]);

  useEffect(() => { load(); }, [load]);

  async function handleRefund(orderId: number | string) {
    if (!confirm("Refund this order?")) return;
    try {
      await adminFetch(apiBase, `/orders/${orderId}/refund`, { method: "POST" });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Refund failed");
    }
  }

  function orderTotal(o: Order) {
    if (o.total) return parseFloat(o.total.replace(/[^0-9.]/g, ""));
    const lineTotal = o.line_items.reduce(
      (sum, li) => sum + li.quantity * li.unit_price, 0,
    );
    return lineTotal - (o.discount ?? 0);
  }

  const activeOrders = orders.filter((o) => !o.is_refunded && o.status !== "refunded");
  const totalRevenue = activeOrders.reduce((sum, o) => sum + orderTotal(o), 0);

  const paymentBreakdown = activeOrders.reduce(
    (acc, o) => {
      const method = o.payment_method || o.status || "unknown";
      acc[method] = (acc[method] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  return (
    <div className="p-8 max-w-7xl">
      <div className="mb-8">
        <h1 className="text-3xl font-light mb-1" style={{ color: "var(--text-primary, #E8F0F8)" }}>
          Orders & Sales
        </h1>
        <p className="text-sm font-light" style={{ color: "var(--text-muted, #4A6A8A)" }}>
          View orders and process refunds
        </p>
      </div>

      {error && (
        <div className="rounded-xl px-4 py-3 text-sm mb-4" style={{ background: "rgba(248,113,113,0.1)", color: "var(--accent-danger, #f87171)" }}>
          {error}
          <button onClick={() => setError(null)} className="float-right">✕</button>
        </div>
      )}

      {/* Quick stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 mb-8">
        {[
          { icon: DollarSign, label: "Revenue", value: `$${totalRevenue.toFixed(2)}` },
          { icon: ShoppingCart, label: "Orders", value: String(activeOrders.length) },
          { icon: CreditCard, label: "Payment Methods", value: null },
        ].map((s) => (
          <div
            key={s.label}
            className="rounded-2xl p-5"
            style={{
              background: "var(--bg-surface, #0A1628)",
              border: "1px solid var(--glass-border, rgba(26,42,64,0.8))",
            }}
          >
            <div className="flex items-center gap-2 mb-2">
              <s.icon className="w-4 h-4" style={{ color: "var(--accent-primary, #00E5FF)" }} />
              <span className="text-xs uppercase tracking-[0.22em]" style={{ color: "var(--text-ghost, #2A4A6A)" }}>
                {s.label}
              </span>
            </div>
            {s.value ? (
              <p className="text-2xl font-light" style={{ color: "var(--text-primary, #E8F0F8)" }}>{s.value}</p>
            ) : (
              <div className="flex flex-wrap gap-2 mt-1">
                {Object.entries(paymentBreakdown).map(([method, count]) => (
                  <span key={method} className="text-xs px-2 py-0.5 rounded-full"
                    style={{ background: "var(--bg-elevated, #1A2A40)", color: "var(--text-secondary, #8EACCD)" }}>
                    {method}: {count}
                  </span>
                ))}
                {Object.keys(paymentBreakdown).length === 0 && (
                  <span className="text-xs" style={{ color: "var(--text-muted, #4A6A8A)" }}>No data</span>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Orders table */}
      <div
        className="rounded-2xl overflow-hidden"
        style={{
          background: "var(--bg-surface, #0A1628)",
          border: "1px solid var(--glass-border, rgba(26,42,64,0.8))",
        }}
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: "var(--bg-elevated, #1A2A40)", borderBottom: "1px solid var(--glass-border)" }}>
                {["Order", "Date", "Customer", "Total", "Status", "Actions"].map((h) => (
                  <th
                    key={h}
                    className={`text-[10px] uppercase tracking-[0.22em] py-3 px-4 ${h === "Total" || h === "Status" || h === "Actions" ? "text-right" : "text-left"}`}
                    style={{ color: "var(--text-ghost, #2A4A6A)" }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="text-center py-8" style={{ color: "var(--text-muted)" }}>Loading…</td></tr>
              ) : orders.length === 0 ? (
                <tr><td colSpan={6} className="text-center py-8" style={{ color: "var(--text-muted)" }}>No orders found</td></tr>
              ) : orders.map((o) => (
                <tr key={o.id} className="transition-colors" style={{ borderBottom: "1px solid var(--bg-elevated, #1A2A40)" }}>
                  <td className="py-3 px-4 text-xs font-mono" style={{ color: "var(--text-secondary, #8EACCD)" }}>
                    {o.order_number ? `#${o.order_number}` : `#${o.id}`}
                  </td>
                  <td className="py-3 px-4" style={{ color: "var(--text-muted, #4A6A8A)" }}>
                    {o.date || o.created_at || "—"}
                  </td>
                  <td className="py-3 px-4" style={{ color: "var(--text-secondary, #8EACCD)" }}>
                    {o.customer_email || "Anonymous"}
                  </td>
                  <td className="py-3 px-4 text-right font-medium" style={{ color: "var(--text-primary, #E8F0F8)" }}>
                    {o.total || `$${orderTotal(o).toFixed(2)}`}
                  </td>
                  <td className="py-3 px-4 text-right">
                    <span
                      className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full"
                      style={{
                        background: o.is_refunded || o.status === "refunded"
                          ? "rgba(248,113,113,0.15)" : "rgba(74,222,128,0.15)",
                        color: o.is_refunded || o.status === "refunded"
                          ? "var(--accent-danger, #f87171)" : "var(--accent-success, #4ade80)",
                      }}
                    >
                      {o.is_refunded ? "Refunded" : (o.status || "Completed")}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-right">
                    {!o.is_refunded && o.status !== "refunded" && (
                      <button onClick={() => handleRefund(o.id)}
                        className="p-1.5 rounded-lg transition-colors" title="Refund"
                        style={{ color: "var(--accent-danger, #f87171)" }}>
                        <RefreshCcw className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
