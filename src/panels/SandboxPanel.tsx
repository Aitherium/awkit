/**
 * Sandbox Panel — dev sandboxes in this workspace.
 *
 * Lists the sandboxes the CURRENT USER may see (their own + shared; leads see
 * all registry sandboxes), creates new ones, and tears them down. Sessions run
 * INSIDE a sandbox — members cannot create bare host sessions (the daemon runs
 * on the owner's machine), so the sandbox is the confinement.
 */

import React, { useCallback, useEffect, useState } from "react";
import { Box, Loader2, Plus, Trash2 } from "lucide-react";
import { rewriteApiUrl } from "@aitherium/awkit/lib";

interface Sandbox {
  id?: string;
  slug?: string;
  workspace_id?: string;
  status?: string;
  container?: string;
}

async function api<T = any>(path: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(rewriteApiUrl(`/api/workspace/harness${path}`), {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`${resp.status}: ${body.slice(0, 200)}`);
  }
  return resp.json();
}

export const SandboxPanel: React.FC = () => {
  const [boxes, setBoxes] = useState<Sandbox[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [slug, setSlug] = useState("");
  const [repos, setRepos] = useState("");
  const [creating, setCreating] = useState(false);

  const fetchBoxes = useCallback(async () => {
    try {
      const data = await api<{ sandboxes: Sandbox[] }>("/sandboxes");
      setBoxes(data.sandboxes || []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load sandboxes");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchBoxes();
    const interval = setInterval(fetchBoxes, 8000);
    return () => clearInterval(interval);
  }, [fetchBoxes]);

  const create = async () => {
    if (!slug.trim()) return;
    setCreating(true);
    setError(null);
    try {
      await api("/sandboxes", {
        method: "POST",
        body: JSON.stringify({
          workspace_slug: slug.trim(),
          repos: repos.split(/\s+/).filter(Boolean),
        }),
      });
      setSlug("");
      setRepos("");
      await fetchBoxes();
    } catch (err) {
      setError(err instanceof Error ? err.message : "create failed");
    } finally {
      setCreating(false);
    }
  };

  const destroy = async (id: string) => {
    try {
      await api(`/sandboxes/${id}`, { method: "DELETE" });
      await fetchBoxes();
    } catch (err) {
      setError(err instanceof Error ? err.message : "teardown failed");
    }
  };

  return (
    <div className="p-4 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Box className="w-4 h-4" /> Sandboxes
        </h2>
        <div className="flex gap-2 items-center text-sm">
          <input
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && create()}
            placeholder="slug (e.g. dev)"
            className="bg-elevated rounded px-2 py-1 w-32"
          />
          <input
            value={repos}
            onChange={(e) => setRepos(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && create()}
            placeholder="repos (space-separated)"
            className="bg-elevated rounded px-2 py-1 w-56"
          />
          <button
            onClick={create}
            disabled={creating || !slug.trim()}
            className="px-3 py-1 rounded bg-primary/20 hover:bg-primary/30 disabled:opacity-50"
          >
            <Plus className="w-3.5 h-3.5 inline" /> create
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3 rounded border border-red-500/40 bg-red-500/10 text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-muted text-sm flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> loading…
        </div>
      ) : boxes.length === 0 ? (
        <div className="text-muted text-sm">
          No sandboxes yet. Create one above, then run sessions inside it from
          the Sessions or Terminal panel (members must name their own sandbox).
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {boxes.map((b) => {
            const id = b.id || b.workspace_id || b.slug || "";
            return (
              <div
                key={id}
                className="border rounded-lg p-3 flex items-center gap-3 text-sm"
              >
                <Box className="w-4 h-4 text-muted" />
                <div className="flex-1 min-w-0">
                  <div className="font-mono text-xs truncate">{id}</div>
                  <div className="text-xs text-muted truncate">
                    {b.slug || b.workspace_id} · {b.status || "provisioned"}
                  </div>
                </div>
                <button
                  onClick={() => destroy(id)}
                  className="px-2 py-1 rounded bg-red-500/15 hover:bg-red-500/30 text-xs"
                >
                  <Trash2 className="w-3 h-3 inline" /> teardown
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default SandboxPanel;
