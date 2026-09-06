"use client";

import { useEffect, useState, useCallback } from "react";
import { ExternalLink, Save } from "lucide-react";
import { adminFetch } from "./AdminAPI";

export interface SettingsManagerProps {
  apiBase?: string;
  portalUrl?: string;
  settingsEndpoint?: string;
}

function FieldRow({
  label, value, onChange, placeholder, readOnly,
}: {
  label: string; value: string; onChange?: (v: string) => void; placeholder?: string; readOnly?: boolean;
}) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 py-4"
      style={{ borderBottom: "1px solid var(--glass-border, rgba(26,42,64,0.8))" }}>
      <label className="text-xs uppercase tracking-[0.24em] shrink-0 min-w-[160px]"
        style={{ color: "var(--text-muted, #4A6A8A)" }}>
        {label}
      </label>
      {readOnly ? (
        <span className="text-right text-sm break-all" style={{ color: "var(--text-secondary, #8EACCD)" }}>
          {value || "—"}
        </span>
      ) : (
        <input type="text"
          className="flex-1 rounded-full px-4 py-2 text-sm focus:outline-none text-right transition-colors"
          style={{
            background: "var(--bg-elevated, #1A2A40)",
            border: "1px solid var(--glass-border, rgba(26,42,64,0.8))",
            color: "var(--text-primary, #E8F0F8)",
          }}
          value={value} onChange={(e) => onChange?.(e.target.value)} placeholder={placeholder} />
      )}
    </div>
  );
}

function StatusPill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className="inline-flex items-center rounded-full px-3 py-1 text-[11px] uppercase tracking-[0.22em]"
      style={{
        background: ok ? "rgba(74,222,128,0.15)" : "rgba(248,113,113,0.15)",
        color: ok ? "var(--accent-success, #4ade80)" : "var(--accent-danger, #f87171)",
      }}>
      {label}
    </span>
  );
}

export default function SettingsManager({
  apiBase = "/api/shop",
  portalUrl,
  settingsEndpoint = "/api/settings",
}: SettingsManagerProps) {
  const [draft, setDraft] = useState({
    name: "", tagline: "", supportEmail: "", website: "",
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    // Try to load settings from the settings endpoint or brand endpoint
    fetch(settingsEndpoint)
      .then((r) => r.json())
      .then((data) => {
        setDraft({
          name: data.brand?.name || data.name || "",
          tagline: data.brand?.tagline || data.tagline || "",
          supportEmail: data.brand?.supportEmail || data.support_email || "",
          website: data.brand?.website || data.website || "",
        });
        setLoaded(true);
      })
      .catch(() => {
        // Try /api/brand as fallback
        fetch(`${apiBase.replace("/shop", "/brand")}/config`)
          .then((r) => r.json())
          .then((data) => {
            setDraft({
              name: data.name || "",
              tagline: data.tagline || "",
              supportEmail: data.support_email || "",
              website: data.website || "",
            });
            setLoaded(true);
          })
          .catch(() => setLoaded(true));
      });
  }, [settingsEndpoint, apiBase]);

  const handleSave = useCallback(async () => {
    setSaving(true); setSaved(false); setError(null);
    try {
      const res = await fetch(settingsEndpoint, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brand: {
            name: draft.name,
            tagline: draft.tagline,
            supportEmail: draft.supportEmail || null,
          },
        }),
      });
      if (!res.ok) throw new Error("Save failed");
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch {
      setError("Failed to save settings.");
    } finally { setSaving(false); }
  }, [draft, settingsEndpoint]);

  if (!loaded) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--bg-deep)" }}>
        <p className="animate-pulse" style={{ color: "var(--text-muted)" }}>Loading settings…</p>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-light mb-1" style={{ color: "var(--text-primary, #E8F0F8)" }}>Settings</h1>
        <p className="text-sm font-light" style={{ color: "var(--text-muted, #4A6A8A)" }}>
          Brand identity and store configuration
        </p>
      </div>

      <div className="grid gap-8 lg:grid-cols-3">
        {/* Sidebar — status */}
        <div className="lg:col-span-1 space-y-6">
          <div className="rounded-2xl p-6" style={{ background: "var(--bg-surface, #0A1628)", border: "1px solid var(--glass-border)" }}>
            <h2 className="text-xl font-light mb-4" style={{ color: "var(--text-primary)" }}>Status</h2>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm" style={{ color: "var(--text-muted)" }}>Backend API</span>
                <StatusPill ok label="Connected" />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm" style={{ color: "var(--text-muted)" }}>Mode</span>
                <StatusPill ok label="Headless" />
              </div>
            </div>
          </div>

          {portalUrl && (
            <a href={portalUrl} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-2 rounded-2xl p-6 transition-colors"
              style={{
                background: "var(--bg-surface, #0A1628)",
                border: "1px solid var(--glass-border)",
                color: "var(--accent-primary, #00E5FF)",
              }}>
              <ExternalLink className="w-5 h-5" />
              <div>
                <p className="text-sm font-medium">Platform Portal</p>
                <p className="text-xs" style={{ color: "var(--text-muted)" }}>Full admin in Aitherium Portal</p>
              </div>
            </a>
          )}
        </div>

        {/* Main form */}
        <div className="lg:col-span-2 rounded-2xl p-8"
          style={{ background: "var(--bg-surface, #0A1628)", border: "1px solid var(--glass-border)" }}>
          <div className="flex items-center justify-between gap-4 mb-6">
            <h2 className="text-xl font-light" style={{ color: "var(--text-primary)" }}>Brand & Identity</h2>
            <div className="flex items-center gap-3">
              {saved && <span className="text-xs" style={{ color: "var(--accent-success)" }}>Saved</span>}
              {error && <span className="text-xs" style={{ color: "var(--accent-danger)" }}>{error}</span>}
              <button onClick={handleSave} disabled={saving}
                className="flex items-center gap-2 px-6 py-2 rounded-full text-xs uppercase tracking-[0.2em] disabled:opacity-50"
                style={{ background: "var(--accent-primary, #00E5FF)", color: "var(--bg-deep, #060D1A)", fontWeight: 600 }}>
                <Save className="w-3.5 h-3.5" />
                {saving ? "Saving…" : "Save Changes"}
              </button>
            </div>
          </div>
          <FieldRow label="Brand name" value={draft.name} onChange={(v) => setDraft((d) => ({ ...d, name: v }))} placeholder="Brand Name" />
          <FieldRow label="Tagline" value={draft.tagline} onChange={(v) => setDraft((d) => ({ ...d, tagline: v }))} placeholder="Your tagline here" />
          <FieldRow label="Support email" value={draft.supportEmail} onChange={(v) => setDraft((d) => ({ ...d, supportEmail: v }))} placeholder="support@brand.com" />
          <FieldRow label="Website" value={draft.website} onChange={(v) => setDraft((d) => ({ ...d, website: v }))} placeholder="https://brand.com" />
        </div>
      </div>
    </div>
  );
}
