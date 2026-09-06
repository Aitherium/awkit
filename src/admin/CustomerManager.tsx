"use client";

import { useEffect, useState, useCallback } from "react";
import { Users, Plus, Pencil, Search, ShoppingBag, Trash2 } from "lucide-react";
import { adminFetch, type Customer, type CustomerCreate } from "./AdminAPI";

export interface CustomerManagerProps {
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
        <div className="flex items-center justify-between px-6 py-4"
          style={{ borderBottom: "1px solid var(--glass-border, rgba(26,42,64,0.8))" }}>
          <h3 className="text-xl font-light" style={{ color: "var(--text-primary, #E8F0F8)" }}>{title}</h3>
          <button onClick={onClose} className="text-xl" style={{ color: "var(--text-muted, #4A6A8A)" }}>✕</button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}

function FormField({
  label, value, onChange, type = "text", placeholder, required, multiline,
}: {
  label: string; value: string; onChange: (v: string) => void;
  type?: string; placeholder?: string; required?: boolean; multiline?: boolean;
}) {
  const style = {
    background: "var(--bg-elevated, #1A2A40)",
    border: "1px solid var(--glass-border, rgba(26,42,64,0.8))",
    color: "var(--text-primary, #E8F0F8)",
  };
  return (
    <div>
      <label className="block text-xs uppercase tracking-[0.22em] mb-1.5" style={{ color: "var(--text-muted, #4A6A8A)" }}>
        {label}
      </label>
      {multiline ? (
        <textarea value={value} onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-xl px-4 py-2.5 text-sm focus:outline-none min-h-[80px]"
          style={style} placeholder={placeholder} required={required} />
      ) : (
        <input type={type} value={value} onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-xl px-4 py-2.5 text-sm focus:outline-none"
          style={style} placeholder={placeholder} required={required} />
      )}
    </div>
  );
}

export default function CustomerManager({ apiBase = "/api/shop" }: CustomerManagerProps) {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({ name: "", email: "", phone: "", notes: "" });

  const load = useCallback(async () => {
    try {
      const q = search ? `?search=${encodeURIComponent(search)}` : "";
      const data = await adminFetch<Customer[]>(apiBase, `/customers${q}`);
      setCustomers(data);
    } catch { setError("Failed to load customers"); }
    finally { setLoading(false); }
  }, [apiBase, search]);

  useEffect(() => { load(); }, [load]);

  function resetForm() { setForm({ name: "", email: "", phone: "", notes: "" }); }

  function openEdit(c: Customer) {
    setForm({ name: c.name, email: c.email ?? "", phone: c.phone ?? "", notes: c.notes ?? "" });
    setEditing(c);
  }

  async function handleSave() {
    const data: CustomerCreate = {
      name: form.name,
      email: form.email || undefined,
      phone: form.phone || undefined,
      notes: form.notes || undefined,
    };
    try {
      if (editing) {
        await adminFetch(apiBase, `/customers/${editing.id}`, { method: "PUT", body: JSON.stringify(data) });
      } else {
        await adminFetch(apiBase, "/customers", { method: "POST", body: JSON.stringify(data) });
      }
      setShowCreate(false); setEditing(null); resetForm(); load();
    } catch (e) { setError(e instanceof Error ? e.message : "Save failed"); }
  }

  async function handleDelete(c: Customer) {
    if (!confirm(`Delete customer "${c.name}"?`)) return;
    try { await adminFetch(apiBase, `/customers/${c.id}`, { method: "DELETE" }); load(); }
    catch (e) { setError(e instanceof Error ? e.message : "Delete failed"); }
  }

  return (
    <div className="p-8 max-w-7xl">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-light mb-1" style={{ color: "var(--text-primary, #E8F0F8)" }}>Customers</h1>
          <p className="text-sm font-light" style={{ color: "var(--text-muted, #4A6A8A)" }}>
            View and manage your customer directory
          </p>
        </div>
        <button
          onClick={() => { resetForm(); setShowCreate(true); }}
          className="flex items-center gap-2 px-5 py-2.5 rounded-full text-xs uppercase tracking-[0.2em] transition-colors"
          style={{ background: "var(--accent-primary, #00E5FF)", color: "var(--bg-deep, #060D1A)", fontWeight: 600 }}
        >
          <Plus className="w-3.5 h-3.5" /> Add Customer
        </button>
      </div>

      {error && (
        <div className="rounded-xl px-4 py-3 text-sm mb-4" style={{ background: "rgba(248,113,113,0.1)", color: "var(--accent-danger, #f87171)" }}>
          {error}
          <button onClick={() => setError(null)} className="float-right">✕</button>
        </div>
      )}

      <div className="relative mb-6">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: "var(--text-ghost, #2A4A6A)" }} />
        <input
          type="text" value={search} onChange={(e) => setSearch(e.target.value)}
          className="w-full rounded-full pl-11 pr-5 py-3 text-sm focus:outline-none"
          style={{
            background: "var(--bg-surface, #0A1628)",
            border: "1px solid var(--glass-border, rgba(26,42,64,0.8))",
            color: "var(--text-primary, #E8F0F8)",
          }}
          placeholder="Search by name or email…"
        />
      </div>

      {/* Customer grid */}
      {loading ? (
        <p className="animate-pulse" style={{ color: "var(--text-muted, #4A6A8A)" }}>Loading…</p>
      ) : customers.length === 0 ? (
        <div className="text-center py-16" style={{ color: "var(--text-muted, #4A6A8A)" }}>
          <Users className="w-8 h-8 mx-auto mb-3 opacity-40" />
          <p>No customers found</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {customers.map((c) => (
            <div
              key={c.id}
              className="rounded-2xl p-5 transition-shadow"
              style={{
                background: "var(--bg-surface, #0A1628)",
                border: "1px solid var(--glass-border, rgba(26,42,64,0.8))",
              }}
            >
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h3 className="font-medium" style={{ color: "var(--text-primary, #E8F0F8)" }}>{c.name}</h3>
                  {c.email && <p className="text-xs mt-0.5" style={{ color: "var(--text-muted, #4A6A8A)" }}>{c.email}</p>}
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => openEdit(c)} className="p-1.5 rounded-lg transition-colors" title="Edit"
                    style={{ color: "var(--text-muted, #4A6A8A)" }}>
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => handleDelete(c)} className="p-1.5 rounded-lg transition-colors" title="Delete"
                    style={{ color: "var(--accent-danger, #f87171)" }}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
              {c.phone && <p className="text-xs mb-1" style={{ color: "var(--text-muted, #4A6A8A)" }}>{c.phone}</p>}
              {c.notes && <p className="text-xs italic line-clamp-2" style={{ color: "var(--text-ghost, #2A4A6A)" }}>{c.notes}</p>}
            </div>
          ))}
        </div>
      )}

      {/* Create/Edit modal */}
      <Modal open={showCreate || !!editing} onClose={() => { setShowCreate(false); setEditing(null); resetForm(); }}
        title={editing ? "Edit Customer" : "New Customer"}>
        <div className="space-y-4">
          <FormField label="Name" value={form.name} onChange={(v) => setForm((f) => ({ ...f, name: v }))} required placeholder="Customer Name" />
          <div className="grid grid-cols-2 gap-4">
            <FormField label="Email" value={form.email} onChange={(v) => setForm((f) => ({ ...f, email: v }))} type="email" placeholder="email@example.com" />
            <FormField label="Phone" value={form.phone} onChange={(v) => setForm((f) => ({ ...f, phone: v }))} placeholder="555-0123" />
          </div>
          <FormField label="Notes" value={form.notes} onChange={(v) => setForm((f) => ({ ...f, notes: v }))} placeholder="Customer notes…" multiline />
          <div className="flex justify-end gap-3 pt-2">
            <button onClick={() => { setShowCreate(false); setEditing(null); resetForm(); }}
              className="px-5 py-2 rounded-full text-sm"
              style={{ border: "1px solid var(--glass-border)", color: "var(--text-muted)" }}>
              Cancel
            </button>
            <button onClick={handleSave}
              className="px-6 py-2 rounded-full text-xs uppercase tracking-[0.2em]"
              style={{ background: "var(--accent-primary, #00E5FF)", color: "var(--bg-deep, #060D1A)", fontWeight: 600 }}>
              {editing ? "Update" : "Create"}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
