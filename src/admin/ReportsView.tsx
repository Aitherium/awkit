"use client";

import { useEffect, useState } from "react";
import { BarChart3, TrendingUp, DollarSign, Package, AlertTriangle } from "lucide-react";
import { adminFetch, type SalesSummary, type LowStockReport } from "./AdminAPI";

export interface ReportsViewProps {
  apiBase?: string;
}

function StatCard({
  icon, label, value, sub, highlight,
}: {
  icon: React.ReactNode; label: string; value: string; sub?: string; highlight?: boolean;
}) {
  return (
    <div
      className="rounded-2xl p-5"
      style={{
        background: "var(--bg-surface, #0A1628)",
        border: "1px solid var(--glass-border, rgba(26,42,64,0.8))",
      }}
    >
      <div className="flex items-center gap-2 mb-2" style={{ color: "var(--text-muted, #4A6A8A)" }}>
        {icon}
        <span className="text-[10px] uppercase tracking-[0.2em]">{label}</span>
      </div>
      <p className="text-2xl font-light" style={{ color: highlight ? "var(--accent-success, #4ade80)" : "var(--text-primary, #E8F0F8)" }}>
        {value}
      </p>
      {sub && <p className="text-xs mt-0.5" style={{ color: "var(--text-muted, #4A6A8A)" }}>{sub}</p>}
    </div>
  );
}

export default function ReportsView({ apiBase = "/api/shop" }: ReportsViewProps) {
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"overview" | "lowstock">("overview");
  const [summary, setSummary] = useState<SalesSummary | null>(null);
  const [lowStock, setLowStock] = useState<LowStockReport | null>(null);

  useEffect(() => {
    async function loadAll() {
      setLoading(true);
      try {
        const [sum, ls] = await Promise.all([
          adminFetch<SalesSummary>(apiBase, "/reports/sales").catch(() => null),
          adminFetch<LowStockReport>(apiBase, "/reports/inventory/low-stock").catch(() => null),
        ]);
        // Fall back to stats if no reports endpoint
        if (!sum) {
          const stats = await adminFetch<{ total_orders: number; total_revenue_cents: number; active_products: number }>(
            apiBase, "/stats",
          ).catch(() => null);
          if (stats) {
            setSummary({
              total_revenue: stats.total_revenue_cents / 100,
              total_orders: stats.total_orders,
              avg_order_value: stats.total_orders ? (stats.total_revenue_cents / 100) / stats.total_orders : 0,
            });
          }
        } else {
          setSummary(sum);
        }
        setLowStock(ls);
      } catch { /* ignore */ }
      setLoading(false);
    }
    loadAll();
  }, [apiBase]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <BarChart3 className="w-6 h-6 animate-pulse" style={{ color: "var(--accent-primary, #00E5FF)" }} />
      </div>
    );
  }

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <h1 className="text-2xl font-light mb-2" style={{ color: "var(--text-primary, #E8F0F8)" }}>Reports</h1>
      <p className="text-sm mb-6" style={{ color: "var(--text-muted, #4A6A8A)" }}>
        Sales analytics and inventory health
      </p>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 rounded-full p-1 w-fit" style={{ background: "var(--bg-elevated, #1A2A40)" }}>
        {(["overview", "lowstock"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className="px-5 py-2 rounded-full text-xs uppercase tracking-[0.18em] transition-all"
            style={{
              background: tab === t ? "var(--bg-surface, #0A1628)" : "transparent",
              color: tab === t ? "var(--text-primary, #E8F0F8)" : "var(--text-muted, #4A6A8A)",
              boxShadow: tab === t ? "var(--shadow, 0 4px 24px rgba(0,0,0,0.3))" : "none",
            }}
          >
            {t === "overview" ? "Sales Overview" : "Low Stock"}
          </button>
        ))}
      </div>

      {/* Sales Overview */}
      {tab === "overview" && summary && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <StatCard icon={<DollarSign className="w-5 h-5" />} label="Total Revenue"
              value={`$${summary.total_revenue.toFixed(2)}`} sub={`${summary.total_orders} orders`} />
            <StatCard icon={<TrendingUp className="w-5 h-5" />} label="Avg Order Value"
              value={`$${summary.avg_order_value.toFixed(2)}`} sub="Per transaction" />
            <StatCard icon={<Package className="w-5 h-5" />} label="Products Sold"
              value={String(summary.top_products_by_quantity?.reduce((s, p) => s + (p.units || 0), 0) ?? "—")}
              sub="Total units" />
          </div>

          {summary.top_products_by_quantity && summary.top_products_by_quantity.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {[
                { title: "Top Products by Units Sold", data: summary.top_products_by_quantity, key: "units" },
                { title: "Top Products by Revenue", data: summary.top_products_by_revenue, key: "revenue" },
              ].map((section) => (
                <div
                  key={section.title}
                  className="rounded-2xl p-5"
                  style={{
                    background: "var(--bg-surface, #0A1628)",
                    border: "1px solid var(--glass-border, rgba(26,42,64,0.8))",
                  }}
                >
                  <h3 className="text-xs uppercase tracking-[0.2em] mb-4" style={{ color: "var(--text-ghost, #2A4A6A)" }}>
                    {section.title}
                  </h3>
                  <div className="space-y-3">
                    {(section.data ?? []).slice(0, 10).map((p, i) => (
                      <div key={i} className="flex justify-between items-center">
                        <div className="flex items-center gap-2">
                          <span className="text-xs w-5" style={{ color: "var(--text-ghost, #2A4A6A)" }}>{i + 1}.</span>
                          <span className="text-sm" style={{ color: "var(--text-primary, #E8F0F8)" }}>{p.name}</span>
                        </div>
                        <span className="text-sm font-mono" style={{ color: "var(--accent-primary, #00E5FF)" }}>
                          {section.key === "units" ? `${p.units} units` : `$${(p.revenue || 0).toFixed(2)}`}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Low Stock */}
      {tab === "lowstock" && (
        <div className="space-y-6">
          <div
            className="rounded-2xl p-5"
            style={{
              background: "var(--bg-surface, #0A1628)",
              border: "1px solid var(--glass-border, rgba(26,42,64,0.8))",
            }}
          >
            <h3 className="text-xs uppercase tracking-[0.2em] mb-4 flex items-center gap-2" style={{ color: "var(--text-ghost, #2A4A6A)" }}>
              <AlertTriangle className="w-4 h-4" /> Low Stock Products
            </h3>
            {!lowStock || lowStock.products.length === 0 ? (
              <p className="text-sm" style={{ color: "var(--accent-success, #4ade80)" }}>All inventory levels are healthy</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[10px] uppercase tracking-[0.2em]" style={{ color: "var(--text-ghost, #2A4A6A)" }}>
                    <th className="text-left py-2">Product</th>
                    <th className="text-right py-2">On Hand</th>
                    <th className="text-right py-2">Threshold</th>
                    <th className="text-right py-2">Deficit</th>
                  </tr>
                </thead>
                <tbody>
                  {lowStock.products.map((p, i) => (
                    <tr key={i} style={{ borderTop: "1px solid var(--bg-elevated, #1A2A40)" }}>
                      <td className="py-2" style={{ color: "var(--text-primary, #E8F0F8)" }}>{p.product}</td>
                      <td className="py-2 text-right font-mono" style={{ color: "var(--accent-danger, #f87171)" }}>{p.quantity}</td>
                      <td className="py-2 text-right font-mono" style={{ color: "var(--text-muted, #4A6A8A)" }}>{p.threshold}</td>
                      <td className="py-2 text-right font-mono" style={{ color: "var(--accent-danger, #f87171)" }}>-{p.deficit}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
