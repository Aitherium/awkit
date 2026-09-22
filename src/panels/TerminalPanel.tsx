/**
 * Terminal Panel — a live terminal harness session in this workspace.
 *
 * Creates a `terminal` harness session (inside a sandbox for non-lead roles),
 * renders its pty output from the events stream, and forwards keystrokes.
 * The daemon bearer never reaches the browser — everything goes through the
 * workspace harness router.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Send, Square, Terminal as TerminalIcon } from "lucide-react";
import { rewriteApiUrl } from "@aitherium/awkit/lib";

interface PtyEvent {
  seq: number;
  kind: string;
  text?: string;
  data?: string;
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

export const TerminalPanel: React.FC = () => {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [lines, setLines] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sandbox, setSandbox] = useState("");
  const [ready, setReady] = useState(false);
  const lastSeq = useRef(0);
  const outRef = useRef<HTMLDivElement>(null);

  const append = useCallback((text: string) => {
    setLines((prev) => {
      const merged = prev.length ? [...prev] : [""];
      const tail = merged[merged.length - 1];
      const split = (tail + text).split("\n");
      merged[merged.length - 1] = split.shift() ?? "";
      return [...merged, ...split].slice(-500);
    });
  }, []);

  const poll = useCallback(async (id: string) => {
    try {
      const data = await api<{ events: PtyEvent[]; last_seq: number }>(
        `/sessions/${id}/events?since=${lastSeq.current}`
      );
      if (data.events?.length) {
        for (const e of data.events) {
          if (e.kind === "pty" || e.kind === "text" || e.kind === "text.delta") {
            append(e.text ?? e.data ?? "");
          }
        }
        lastSeq.current = data.last_seq || lastSeq.current;
      }
    } catch {
      // transient
    }
  }, [append]);

  useEffect(() => {
    if (!sessionId) return;
    setReady(true);
    lastSeq.current = 0;
    const interval = setInterval(() => poll(sessionId), 1000);
    return () => clearInterval(interval);
  }, [sessionId, poll]);

  useEffect(() => {
    outRef.current?.scrollTo({ top: outRef.current.scrollHeight });
  }, [lines]);

  const start = async () => {
    setStarting(true);
    setError(null);
    try {
      const body: Record<string, string> = { harness: "terminal" };
      if (sandbox.trim()) body.sandbox = sandbox.trim();
      const result = await api<{ session?: { id?: string }; id?: string }>("/sessions", {
        method: "POST",
        body: JSON.stringify(body),
      });
      const id = (result.session || {}).id || result.id;
      if (!id) throw new Error("no session id returned");
      setSessionId(id);
      setLines([]);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "start failed — members need a sandbox; create one in the Sandbox panel first"
      );
    } finally {
      setStarting(false);
    }
  };

  const send = async () => {
    if (!sessionId || !input) return;
    try {
      await api(`/sessions/${sessionId}/input`, {
        method: "POST",
        body: JSON.stringify({ text: input }),
      });
      append(input + "\r\n");
      setInput("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "send failed");
    }
  };

  const stop = async () => {
    if (!sessionId) return;
    try {
      await api(`/sessions/${sessionId}/interrupt`, { method: "POST" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "stop failed");
    }
  };

  return (
    <div className="p-4 flex flex-col gap-3 h-full">
      <div className="flex items-center gap-2">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <TerminalIcon className="w-4 h-4" /> Terminal
        </h2>
        <input
          value={sandbox}
          onChange={(e) => setSandbox(e.target.value)}
          placeholder="sandbox slug (required for members)"
          className="flex-1 bg-elevated rounded px-2 py-1 text-sm max-w-xs"
        />
        {!ready ? (
          <button
            onClick={start}
            disabled={starting}
            className="px-3 py-1 rounded bg-primary/20 hover:bg-primary/30 disabled:opacity-50"
          >
            {starting ? "starting…" : "Start"}
          </button>
        ) : (
          <button
            onClick={stop}
            className="px-3 py-1 rounded bg-red-500/20 hover:bg-red-500/30"
          >
            <Square className="w-3.5 h-3.5 inline" /> stop
          </button>
        )}
      </div>

      {error && (
        <div className="p-3 rounded border border-red-500/40 bg-red-500/10 text-sm">
          {error}
        </div>
      )}

      <div
        ref={outRef}
        className="flex-1 overflow-y-auto bg-black/60 rounded-lg p-3 font-mono text-xs leading-relaxed min-h-40"
      >
        {!sessionId && (
          <div className="text-muted flex items-center gap-2">
            {starting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {starting ? "provisioning…" : "start a terminal session above"}
          </div>
        )}
        {lines.map((l, i) => (
          <div key={i} className="whitespace-pre-wrap break-words">
            {l || " "}
          </div>
        ))}
        {sessionId && (
          <div className="text-muted flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />
            <span className="font-mono text-[10px]">{sessionId.slice(0, 12)}</span>
          </div>
        )}
      </div>

      <div className="flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          disabled={!sessionId}
          placeholder={sessionId ? "type here…" : "start a session first"}
          className="flex-1 bg-elevated rounded px-2 py-1 font-mono text-sm"
        />
        <button
          onClick={send}
          disabled={!sessionId}
          className="px-3 py-1 rounded bg-primary/20 hover:bg-primary/30 disabled:opacity-50"
        >
          <Send className="w-3.5 h-3.5 inline" />
        </button>
      </div>
    </div>
  );
};

export default TerminalPanel;
