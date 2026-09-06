"use client";

import { useEffect, useState, useCallback } from "react";
import { Package, Plus, Pencil, Trash2, Search, ArrowUpDown, Eye, EyeOff } from "lucide-react";
import { adminFetch, normalizeProduct, type Product, type ProductCreate } from "./AdminAPI";

export interface ProductManagerProps {
  apiBase?: string;
}

function Modal({
  open, onClose, children, title,
}: {
  open: boolean; onClose: () => void; children: React.ReactNode; title: string;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div
        className="rounded-2xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto"
        style={{
          background: "var(--bg-surface, #0A1628)",
          border: "1px solid var(--glass-border, rgba(26,42,64,0.8))",
        }}
      >
        <div
          className="flex items-center justify-between px-6 py-4"
          style={{ borderBottom: "1px solid var(--glass-border, rgba(26,42,64,0.8))" }}
        >
          <h3 className="text-xl font-light" style={{ color: "var(--text-primary, #E8F0F8)" }}>{title}</h3>
          <button onClick={onClose} className="text-xl" style={{ color: "var(--text-muted, #4A6A8A)" }}>
            ✕
          </button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}

function FormField({
  label, value, onChange, type = "text", placeholder, required,
}: {
  label: string; value: string | number; onChange: (v: string) => void;
  type?: string; placeholder?: string; required?: boolean;
}) {
  return (
    <div>
      <label
        className="block text-xs uppercase tracking-[0.22em] mb-1.5"
        style={{ color: "var(--text-muted, #4A6A8A)" }}
      >
        {label}
      </label>
      <input
        type={type} value={value} onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-xl px-4 py-2.5 text-sm focus:outline-none transition-colors"
        style={{
          background: "var(--bg-elevated, #1A2A40)",
          border: "1px solid var(--glass-border, rgba(26,42,64,0.8))",
          color: "var(--text-primary, #E8F0F8)",
        }}
        placeholder={placeholder} required={required}
      />
    </div>
  );
}

export default function ProductManager({ apiBase = "/api/shop" }: ProductManagerProps) {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [adjusting, setAdjusting] = useState<Product | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({
    sku: "", name: "", variant: "", retail_price: "", quantity_on_hand: "0", low_stock_threshold: "5",
  });
  const [adjustForm, setAdjustForm] = useState({ quantity: "", reason: "" });

  const load = useCallback(async () => {
    try {
      const res = await adminFetch<{ products?: Product[] } | Product[]>(apiBase, "/products");
      const raw = Array.isArray(res) ? res : (res.products || []);
      const list = raw.map((p) => normalizeProduct(p));
      const filtered = search
        ? list.filter((p) => p.name.toLowerCase().includes(search.toLowerCase()) || p.sku.toLowerCase().includes(search.toLowerCase()))
        : list;
      setProducts(filtered);
    } catch { setError("Failed to load products"); }
    finally { setLoading(false); }
  }, [apiBase, search]);

  useEffect(() => { load(); }, [load]);

  function resetForm() {
    setForm({ sku: "", name: "", variant: "", retail_price: "", quantity_on_hand: "0", low_stock_threshold: "5" });
  }

  function openEdit(p: Product) {
    setForm({
      sku: p.sku, name: p.name, variant: p.variant ?? "",
      retail_price: String(p.retail_price ?? ""),
      quantity_on_hand: String(p.quantity_on_hand),
      low_stock_threshold: String(p.low_stock_threshold),
    });
    setEditing(p);
  }

  async function handleSave() {
    const data: ProductCreate = {
      sku: form.sku, name: form.name, variant: form.variant || undefined,
      retail_price: Number(form.retail_price) || undefined,
      quantity_on_hand: Number(form.quantity_on_hand),
      low_stock_threshold: Number(form.low_stock_threshold),
    };
    try {
      if (editing) {
        await adminFetch(apiBase, `/products/${editing.id}`, { method: "PUT", body: JSON.stringify(data) });
      } else {
        await adminFetch(apiBase, "/products", { method: "POST", body: JSON.stringify(data) });
      }
      setShowCreate(false); setEditing(null); resetForm(); load();
    } catch (e) { setError(e instanceof Error ? e.message : "Save failed"); }
  }

  async function handleDelete(id: number | string) {
    if (!confirm("Delete this product?")) return;
    try { await adminFetch(apiBase, `/products/${id}`, { method: "DELETE" }); load(); }
    catch { setError("Delete failed"); }
  }

  async function handlePublish(id: number | string) {
    try { await adminFetch(apiBase, `/products/${id}/publish`, { method: "POST" }); load(); }
    catch { setError("Publish failed"); }
  }

  async function handleAdjust() {
    if (!adjusting) return;
    try {
      await adminFetch(apiBase, `/products/${adjusting.id}/stock`, {
        method: "PATCH",
        body: JSON.stringify({ quantity_change: Number(adjustForm.quantity), reason: adjustForm.reason }),
      });
      setAdjusting(null); setAdjustForm({ quantity: "", reason: "" }); load();
    } catch (e) { setError(e instanceof Error ? e.message : "Adjust failed"); }
  }

  return (
    <div className="p-8 max-w-7xl">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-light mb-1" style={{ color: "var(--text-primary, #E8F0F8)" }}>
            Products
          </h1>
          <p className="text-sm font-light" style={{ color: "var(--text-muted, #4A6A8A)" }}>
            Manage your product catalog and inventory
          </p>
        </div>
        <button
          onClick={() => { resetForm(); setShowCreate(true); }}
          className="flex items-center gap-2 px-5 py-2.5 rounded-full text-xs uppercase tracking-[0.2em] transition-colors"
          style={{
            background: "var(--accent-primary, #00E5FF)",
            color: "var(--bg-deep, #060D1A)",
            fontWeight: 600,
          }}
        >
          <Plus className="w-3.5 h-3.5" /> Add Product
        </button>
      </div>

      {error && (
        <div className="rounded-xl px-4 py-3 text-sm mb-4" style={{ background: "rgba(248,113,113,0.1)", color: "var(--accent-danger, #f87171)" }}>
          {error}
          <button onClick={() => setError(null)} className="float-right">✕</button>
        </div>
      )}

      {/* Search */}
      <div className="relative mb-6">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: "var(--text-ghost, #2A4A6A)" }} />
        <input
          type="text" value={search} onChange={(e) => setSearch(e.target.value)}
          className="w-full rounded-full pl-11 pr-5 py-3 text-sm focus:outline-none transition-colors"
          style={{
            background: "var(--bg-surface, #0A1628)",
            border: "1px solid var(--glass-border, rgba(26,42,64,0.8))",
            color: "var(--text-primary, #E8F0F8)",
          }}
          placeholder="Search products by name or SKU…"
        />
      </div>

      {/* Products table */}
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
              <tr style={{ background: "var(--bg-elevated, #1A2A40)", borderBottom: "1px solid var(--glass-border, rgba(26,42,64,0.8))" }}>
                {["Product", "SKU", "Price", "Stock", "Status", "Actions"].map((h) => (
                  <th
                    key={h}
                    className={`text-[10px] uppercase tracking-[0.22em] py-3 px-4 ${h === "Price" || h === "Stock" || h === "Status" || h === "Actions" ? "text-right" : "text-left"}`}
                    style={{ color: "var(--text-ghost, #2A4A6A)" }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="text-center py-8" style={{ color: "var(--text-muted, #4A6A8A)" }}>Loading…</td></tr>
              ) : products.length === 0 ? (
                <tr><td colSpan={6} className="text-center py-8" style={{ color: "var(--text-muted, #4A6A8A)" }}>No products found</td></tr>
              ) : products.map((p) => {
                const low = p.quantity_on_hand <= p.low_stock_threshold && p.low_stock_threshold > 0;
                const price = p.retail_price ? `$${Number(p.retail_price).toFixed(2)}` : (p.price || "—");
                return (
                  <tr
                    key={p.id}
                    className="transition-colors hover:opacity-90"
                    style={{ borderBottom: "1px solid var(--bg-elevated, #1A2A40)" }}
                  >
                    <td className="py-3 px-4 flex items-center gap-3">
                      {p.image_asset && (
                        <img src={`/assets/brand-assets/${p.image_asset}`} alt="" className="w-8 h-8 rounded object-contain" />
                      )}
                      <div>
                        <span style={{ color: "var(--text-secondary, #8EACCD)" }}>{p.name}</span>
                        {p.variant && <span className="text-xs ml-1" style={{ color: "var(--text-muted, #4A6A8A)" }}>– {p.variant}</span>}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-xs font-mono" style={{ color: "var(--text-muted, #4A6A8A)" }}>{p.sku}</td>
                    <td className="py-3 px-4 text-right" style={{ color: "var(--text-secondary, #8EACCD)" }}>{price}</td>
                    <td className="py-3 px-4 text-right">
                      <span style={{ color: low ? "var(--accent-warn, #f59e0b)" : p.quantity_on_hand === 0 ? "var(--accent-danger, #f87171)" : "var(--text-secondary, #8EACCD)" }}>
                        {p.quantity_on_hand}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <span
                        className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full"
                        style={{
                          background: p.status === "active"
                            ? "rgba(74,222,128,0.15)"
                            : p.status === "draft"
                              ? "rgba(255,255,255,0.05)"
                              : low ? "rgba(245,158,11,0.15)" : "rgba(74,222,128,0.15)",
                          color: p.status === "active"
                            ? "var(--accent-success, #4ade80)"
                            : p.status === "draft"
                              ? "var(--text-muted, #4A6A8A)"
                              : low ? "var(--accent-warn, #f59e0b)" : "var(--accent-success, #4ade80)",
                        }}
                      >
                        {p.status || (p.quantity_on_hand === 0 ? "Out" : low ? "Low" : "Active")}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {p.status === "draft" && (
                          <button onClick={() => handlePublish(p.id)}
                            className="p-1.5 rounded-lg transition-colors" title="Publish"
                            style={{ color: "var(--accent-success, #4ade80)" }}>
                            <Eye className="w-3.5 h-3.5" />
                          </button>
                        )}
                        <button onClick={() => { setAdjusting(p); setAdjustForm({ quantity: "", reason: "" }); }}
                          className="p-1.5 rounded-lg transition-colors" title="Adjust stock"
                          style={{ color: "var(--text-muted, #4A6A8A)" }}>
                          <ArrowUpDown className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => openEdit(p)}
                          className="p-1.5 rounded-lg transition-colors" title="Edit"
                          style={{ color: "var(--text-muted, #4A6A8A)" }}>
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => handleDelete(p.id)}
                          className="p-1.5 rounded-lg transition-colors" title="Delete"
                          style={{ color: "var(--accent-danger, #f87171)" }}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create / Edit modal */}
      <Modal open={showCreate || !!editing} onClose={() => { setShowCreate(false); setEditing(null); resetForm(); }}
        title={editing ? "Edit Product" : "New Product"}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <FormField label="Name" value={form.name} onChange={(v) => setForm((f) => ({ ...f, name: v }))} required placeholder="Product Name" />
            <FormField label="SKU" value={form.sku} onChange={(v) => setForm((f) => ({ ...f, sku: v }))} required placeholder="AI-PRD-001" />
          </div>
          <FormField label="Variant" value={form.variant} onChange={(v) => setForm((f) => ({ ...f, variant: v }))} placeholder="Size / Color" />
          <div className="grid grid-cols-2 gap-4">
            <FormField label="Price" value={form.retail_price} onChange={(v) => setForm((f) => ({ ...f, retail_price: v }))} type="number" required placeholder="29.99" />
            <FormField label="Initial Stock" value={form.quantity_on_hand} onChange={(v) => setForm((f) => ({ ...f, quantity_on_hand: v }))} type="number" />
          </div>
          <FormField label="Low Stock Threshold" value={form.low_stock_threshold} onChange={(v) => setForm((f) => ({ ...f, low_stock_threshold: v }))} type="number" />
          <div className="flex justify-end gap-3 pt-2">
            <button onClick={() => { setShowCreate(false); setEditing(null); resetForm(); }}
              className="px-5 py-2 rounded-full text-sm transition-colors"
              style={{ border: "1px solid var(--glass-border, rgba(26,42,64,0.8))", color: "var(--text-muted, #4A6A8A)" }}>
              Cancel
            </button>
            <button onClick={handleSave}
              className="px-6 py-2 rounded-full text-xs uppercase tracking-[0.2em] transition-colors"
              style={{ background: "var(--accent-primary, #00E5FF)", color: "var(--bg-deep, #060D1A)", fontWeight: 600 }}>
              {editing ? "Update" : "Create"}
            </button>
          </div>
        </div>
      </Modal>

      {/* Adjust inventory modal */}
      <Modal open={!!adjusting} onClose={() => setAdjusting(null)} title={`Adjust Stock: ${adjusting?.name ?? ""}`}>
        <div className="space-y-4">
          <p className="text-sm" style={{ color: "var(--text-muted, #4A6A8A)" }}>
            Current stock: <strong style={{ color: "var(--text-primary, #E8F0F8)" }}>{adjusting?.quantity_on_hand}</strong>
          </p>
          <FormField label="Quantity Change (+/-)" value={adjustForm.quantity} onChange={(v) => setAdjustForm((f) => ({ ...f, quantity: v }))} type="number" placeholder="+10 or -5" required />
          <FormField label="Reason" value={adjustForm.reason} onChange={(v) => setAdjustForm((f) => ({ ...f, reason: v }))} placeholder="Restock / Damaged / Count correction" required />
          <div className="flex justify-end gap-3 pt-2">
            <button onClick={() => setAdjusting(null)}
              className="px-5 py-2 rounded-full text-sm"
              style={{ border: "1px solid var(--glass-border)", color: "var(--text-muted)" }}>
              Cancel
            </button>
            <button onClick={handleAdjust}
              className="px-6 py-2 rounded-full text-xs uppercase tracking-[0.2em]"
              style={{ background: "var(--accent-primary, #00E5FF)", color: "var(--bg-deep, #060D1A)", fontWeight: 600 }}>
              Adjust
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
