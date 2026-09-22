/**
 * Sessions Panel — Claude Code / agent sessions in this workspace.
 *
 * Lists the sessions the CURRENT USER may see (their own + shared; workspace
 * leads see all registry sessions). Focus one to feed it stdin and tail its
 * events. Everything goes through the workspace harness router — the daemon
 * bearer never reaches the browser.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Play, Send, Square, Terminal } from "lucide-react";
import { rewriteApiUrl } from "@aitherium/awkit/lib";

interface HarnessSession {
  id: string;
  title?: string;
  cwd?: string;
  harness?: string;
  harness_label?: string;
  origin?: string;
  status?: string;
  last_activity_at?: string;
  last_activity_summary?: string;
  steer_capability?: string;
}

interface EventItem {
  seq: number;
  kind: string;
  text?: string;
  tool?: string;
}

const STATUS_DOT: Record<string, string> = {
  idle: "#22c55e",
  working: "#f59e0b",
  "waiting-input": "#f59e0b",
  "waiting-permission": "#ef4444",
  exited: "#6b7280",
};

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

export const SessionsPanel: React.FC = () => {
  const [sessions, setSessions] = useState<HarnessSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [focused, setFocused] = useState<HarnessSession | null>(null);
  const [input, setInput] = useState("");
  const [events, setEvents] = useState<EventItem[]>([]);
  const [creating, setCreating] = useState(false);
  const [newHarness, setNewHarness] = useState("claude");
  const [newPrompt, setNewPrompt] = useState("");
  const lastSeq = useRef(0);
  const tailRef = useRef<HTMLDivElement>(null);

  const fetchSessions = useCallback(async () => {
    try {
      const data = await api<{ sessions: HarnessSession[] }>("/sessions");
      setSessions(data.sessions || []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load sessions");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSessions();
    const interval = setInterval(fetchSessions, 8000);
    return () => clearInterval(interval);
  }, [fetchSessions]);

  const fetchEvents = useCallback(async (sessionId: string) => {
    try {
      const data = await api<{ events: EventItem[]; last_seq: number }>(
        `/sessions/${sessionId}/events?since=${lastSeq.current}`
      );
      if (data.events?.length) {
        setEvents((prev) => [...prev, ...data.events]);
        lastSeq.current = data.last_seq || lastSeq.current;
      }
    } catch {
      // transient — the poll retries
    }
  }, []);

  useEffect(() => {
    if (!focused) return;
    lastSeq.current = 0;
    setEvents([]);
    fetchEvents(focused.id);
    const interval = setInterval(() => fetchEvents(focused.id), 2000);
    return () => clearInterval(interval);
  }, [focused, fetchEvents]);

  useEffect(() => {
    tailRef.current?.scrollTo({ top: tailRef.current.scrollHeight });
  }, [events]);

  const sendInput = async () => {
    if (!focused || !input.trim()) return;
    try {
      await api(`/sessions/${focused.id}/input`, {
        method: "POST",
        body: JSON.stringify({ text: input }),
      });
      setInput("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "send failed");
    }
  };

  const interrupt = async () => {
    if (!focused) return;
    try {
      await api(`/sessions/${focused.id}/interrupt`, { method: "POST" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "interrupt failed");
    }
  };

  const createSession = async () => {
    setCreating(true);
    setError(null);
    try {
      await api("/sessions", {
        method: "POST",
        body: JSON.stringify({ harness: newHarness, prompt: newPrompt }),
      });
      setNewPrompt("");
      await fetchSessions();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "create failed — members need a sandbox; create one in the Sandbox panel first"
      );
    } finally {
      setCreating(false);
    }
  };

  if (loading) {
    return (
      <div className="p-6 text-muted flex items-center gap-2">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading sessions…
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 m-4 rounded border border-red-500/40 bg-red-500/10 text-sm">
        {error}
      </div>
    );
  }

  return (
    <div className="p-4 flex flex-col gap-4 h-full">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Terminal className="w-4 h-4" /> Sessions
        </h2>
        <div className="flex gap-2 items-center text-sm">
          <select
            value={newHarness}
            onChange={(e) => setNewHarness(e.target.value)}
            className="bg-elevated rounded px-2 py-1"
          >
            <option value="claude">claude</option>
            <option value="terminal">terminal</option>
            <option value="aither">aither</option>
          </select>
          <input
            value={newPrompt}
            onChange={(e) => setNewPrompt(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && createSession()}
            placeholder="prompt (optional)"
            className="bg-elevated rounded px-2 py-1 w-56"
          />
          <button
            onClick={createSession}
            disabled={creating}
            className="px-3 py-1 rounded bg-primary/20 hover:bg-primary/30 disabled:opacity-50"
          >
            {creating ? "…" : "New"}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 flex-1 min-h-0">
        <div className="overflow-y-auto border rounded-lg">
          {sessions.length === 0 && (
            <div className="p-4 text-sm text-muted">
              No sessions yet. Create one above — members need a sandbox first
              (Sandbox panel).
            </div>
          )}
          {sessions.map((s) => (
            <button
              key={s.id}
              onClick={() => setFocused(s)}
              className={`w-full text-left px-3 py-2 border-b text-sm hover:bg-surface/60 ${
                focused?.id === s.id ? "bg-primary/10" : ""
              }`}
            >
              <div className="flex items-center gap-2">
                <span
                  className="w-2 h-2 rounded-full"
                  style={{ background: STATUS_DOT[s.status || "idle"] || "#6b7280" }}
                />
                <span className="font-mono text-xs">{s.id.slice(0, 12)}</span>
                <span className="flex-1 truncate">
                  {s.title || s.harness_label || s.harness}
                </span>
                <span className="text-xs text-muted">{s.harness}</span>
              </div>
              <div className="text-xs text-muted truncate mt-0.5">
                {s.steer_capability === "none"
                  ? "observing only"
                  : s.last_activity_summary || s.cwd || ""}
              </div>
            </button>
          ))}
        </div>

        <div className="border rounded-lg flex flex-col min-h-0">
          {focused ? (
            <>
              <div className="px-3 py-2 border-b text-sm flex items-center gap-2">
                <span className="font-mono text-xs">{focused.id.slice(0, 12)}</span>
                <span className="flex-1 truncate text-muted">
                  {focused.title || focused.cwd || ""}
                </span>
                <button
                  onClick={interrupt}
                  className="px-2 py-0.5 rounded bg-red-500/20 hover:bg-red-500/30 text-xs"
                >
                  <Square className="w-3 h-3 inline" /> stop
                </button>
              </div>
              <div
                ref={tailRef}
                className="flex-1 overflow-y-auto p-3 font-mono text-xs whitespace-pre-wrap break-words"
              >
                {events.length === 0 && (
                  <div className="text-muted">waiting for events…</div>
                )}
                {events.map((e, i) => (
                  <div key={i}>
                    {e.kind === "tool.call" && (
                      <span className="text-amber-500/90">⚙ {e.tool}</span>
                    )}
                    {e.kind === "tool.result" && (
                      <span className="text-amber-500/60">✓ {e.tool}</span>
                    )}
                    {e.text && <span>{e.text}</span>}
                    {e.text ? "\n" : null}
                  </div>
                ))}
              </div>
              <div className="p-2 border-t flex gap-2">
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && sendInput()}
                  placeholder={
                    focused.steer_capability === "none"
                      ? "observing — can't type into this session"
                      : "type to the session…"
                  }
                  disabled={focused.steer_capability === "none"}
                  className="flex-1 bg-elevated rounded px-2 py-1 text-sm"
                />
                <button
                  onClick={sendInput}
                  disabled={focused.steer_capability === "none"}
                  className="px-3 py-1 rounded bg-primary/20 hover:bg-primary/30"
                >
                  <Send className="w-3.5 h-3.5 inline" />
                </button>
              </div>
            </>
          ) : (
            <div className="p-4 text-sm text-muted">
              <Play className="w-4 h-4 inline mr-1" /> Select a session to focus it.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default SessionsPanel;
