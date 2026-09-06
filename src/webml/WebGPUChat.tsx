"use client";

import { useState } from "react";
import { DEFAULT_WEBML_MODEL_ID, getWebMLModel } from "./models";
import { useWebGPUChat } from "./useWebGPUChat";
import type { WebMLTools } from "./tool-loop";

const mb = (bytes: number) => (bytes / (1024 * 1024)).toFixed(0);

// Assistant text may carry raw <tool_call> XML (kept in the convo so the
// template can re-render it); the transcript shows it as a subtle action line.
const stripToolCalls = (text: string) =>
  text.replace(/<tool_call>[\s\S]*?(<\/tool_call>|$)/g, "").trim();

export interface WebGPUChatProps {
  /** Each consuming app passes its own bundler-resolvable Worker factory. */
  workerFactory: () => Worker;
  modelId?: string;
  system?: string;
  /** Host-side tools (declared to the model, executed by the host). */
  tools?: WebMLTools;
  /** Optional slot shown when WebGPU is unavailable (else a sensible default). */
  fallback?: React.ReactNode;
  /**
   * Passed straight through to `useWebGPUChat`. Leave it unset: the default REQUIRES a
   * human to agree before any weights download, and this component renders the prompt.
   * Only a host that has already asked in its own flow may set "assume-granted".
   */
  consent?: "require" | "assume-granted";
}

/**
 * Self-contained in-browser (WebGPU) chat. The model runs on the visitor's GPU via
 * transformers.js — no server, no inference cost, private. Drop it into any React app;
 * only the `workerFactory` differs per consumer.
 */
export function WebGPUChat({ workerFactory, modelId = DEFAULT_WEBML_MODEL_ID, system, tools, fallback, consent }: WebGPUChatProps) {
  const model = getWebMLModel(modelId);
  const chat = useWebGPUChat({ workerFactory, modelId, system, tools, consent });
  const [input, setInput] = useState("");
  const [auto, setAuto] = useState(false);

  if (chat.status === "unsupported") {
    return (
      <div style={S.wrap}>
        {fallback ?? (
          <div style={S.notice}>
            <strong>WebGPU isn&apos;t available in this browser.</strong>
            <div style={S.dim}>
              In-browser inference needs WebGPU (Chrome or Edge, or Safari Technology Preview). The rest
              of the app still works — this on-device model just won&apos;t load here.
            </div>
          </div>
        )}
      </div>
    );
  }

  const busy = chat.status === "loading" || chat.status === "generating";

  return (
    <div style={S.wrap}>
      <style>{`@keyframes az-webml-pulse{0%,100%{opacity:1}50%{opacity:.55}}`}</style>
      <div style={S.header}>
        <div>
          <div style={S.title}>{model?.label ?? modelId}</div>
          <div style={S.dim}>{model?.blurb}</div>
        </div>
        {chat.tokensPerSecond != null && (
          <span style={S.badge}>{chat.tokensPerSecond.toFixed(1)} tok/s</span>
        )}
      </div>

      {/* THE ASK. Rendered before every other state so a consumer cannot show a load
          button and a download at the same time. The size is named because the 2026-08-07
          incident ("8B, 1.1 GB, downloading unasked") was filed as a picker bug by someone
          who was never told a number. */}
      {chat.consentNeeded && (
        <div style={S.notice} data-testid="webml-consent">
          <strong>Run {model?.label ?? modelId} on this device?</strong>
          <div style={S.dim}>
            This downloads{" "}
            {model?.approxDownloadMB ? `about ${model.approxDownloadMB} MB` : "the model weights"}{" "}
            to your browser and runs it on your own GPU. Your conversation stays on this
            device — nothing is sent to a server for it.
          </div>
          <label style={{ display: "flex", gap: 8, alignItems: "flex-start", cursor: "pointer" }}>
            {/* Default OFF: a pre-ticked box is a default you must notice to escape. */}
            <input
              type="checkbox"
              data-testid="webml-consent-auto"
              checked={auto}
              onChange={(e) => setAuto(e.target.checked)}
            />
            <span>Load automatically on this device from now on</span>
          </label>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button
              style={S.ghost}
              data-testid="webml-consent-decline"
              onClick={chat.declineConsent}
            >
              Not now
            </button>
            <button
              style={S.primary}
              data-testid="webml-consent-accept"
              onClick={() => chat.grantConsent(auto)}
            >
              Download and run
            </button>
          </div>
        </div>
      )}

      {chat.status === "idle" && !chat.consentNeeded && (
        <button style={S.primary} onClick={chat.load}>
          Load model {model ? `(~${model.approxDownloadMB} MB, one-time)` : ""}
        </button>
      )}

      {chat.status === "loading" && (
        <div style={S.progressWrap}>
          <div style={S.loadHead}>
            <span style={{ fontWeight: 600 }}>
              {chat.progress >= 1 ? "Compiling on your GPU…" : "Downloading model…"}
            </span>
            <span style={S.dim}>{Math.round(chat.progress * 100)}%</span>
          </div>
          <div style={S.track}>
            <div
              style={{
                ...S.fill,
                width: `${Math.max(3, Math.round(chat.progress * 100))}%`,
                ...(chat.progress >= 1 ? S.fillPulse : null),
              }}
            />
          </div>
          <div style={S.loadFoot}>
            <span style={S.dim}>
              {chat.totalBytes > 0
                ? `${mb(chat.loadedBytes)} / ${mb(chat.totalBytes)} MB`
                : "starting…"}
            </span>
            <span style={S.dim}>one-time · cached on your device after this</span>
          </div>
          {chat.currentFile && chat.progress < 1 && (
            <div style={{ ...S.dim, fontSize: 12 }}>fetching {chat.currentFile}</div>
          )}
        </div>
      )}

      {chat.status === "error" && (
        <div style={S.error}>
          <div>Error: {chat.error}</div>
          <div style={{ marginTop: 8, fontSize: 12, opacity: 0.85, lineHeight: 1.6 }}>
            <strong>Run locally instead?</strong> Install <code>awdk</code> (
            <code>pip install awdk</code>) and run <code>adk bonsai-local</code>{" "}
            for GPU-accelerated inference on your own hardware.
          </div>
        </div>
      )}

      {(chat.status === "ready" || chat.status === "generating") && (
        <>
          <div style={S.log}>
            {chat.messages.map((m, i) => {
              if (m.role === "tool") {
                return (
                  <div key={i} style={{ ...S.dim, fontSize: 12, fontStyle: "italic" }}>
                    🔎 consulted a tool
                  </div>
                );
              }
              const shown = m.role === "assistant" ? stripToolCalls(m.content) : m.content;
              if (!shown) {
                // Assistant turn that was ONLY a tool call.
                return (
                  <div key={i} style={{ ...S.dim, fontSize: 12, fontStyle: "italic" }}>
                    ⚙ calling a tool…
                  </div>
                );
              }
              return (
                <div key={i} style={m.role === "user" ? S.user : S.assistant}>
                  {shown}
                </div>
              );
            })}
            {chat.streaming && <div style={S.assistant}>{chat.streaming}</div>}
            {chat.messages.length === 0 && !chat.streaming && (
              <div style={S.dim}>Model loaded and running on your GPU. Ask it anything.</div>
            )}
          </div>
          <form
            style={S.inputRow}
            onSubmit={(e) => {
              e.preventDefault();
              chat.send(input);
              setInput("");
            }}
          >
            <input
              style={S.input}
              value={input}
              placeholder="Message the on-device model…"
              onChange={(e) => setInput(e.target.value)}
              disabled={chat.status === "generating"}
            />
            {chat.status === "generating" ? (
              <button type="button" style={S.secondary} onClick={chat.interrupt}>
                Stop
              </button>
            ) : (
              <button type="submit" style={S.primary} disabled={!input.trim() || busy}>
                Send
              </button>
            )}
          </form>
        </>
      )}
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  wrap: { display: "flex", flexDirection: "column", gap: 12, maxWidth: 720, fontFamily: "system-ui, sans-serif" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 },
  title: { fontWeight: 700, fontSize: 16 },
  dim: { opacity: 0.65, fontSize: 13, lineHeight: 1.5 },
  badge: { fontSize: 12, padding: "2px 8px", borderRadius: 999, background: "rgba(120,120,140,.15)", whiteSpace: "nowrap" },
  primary: { padding: "10px 16px", borderRadius: 10, border: "none", background: "#0d8f9e", color: "#fff", fontWeight: 600, cursor: "pointer" },
  secondary: { padding: "10px 16px", borderRadius: 10, border: "1px solid rgba(120,120,140,.4)", background: "transparent", color: "inherit", cursor: "pointer" },
  progressWrap: { display: "flex", flexDirection: "column", gap: 8 },
  loadHead: { display: "flex", justifyContent: "space-between", alignItems: "baseline", fontSize: 14 },
  loadFoot: { display: "flex", justifyContent: "space-between", alignItems: "baseline", fontSize: 12, fontVariantNumeric: "tabular-nums" },
  track: { height: 8, borderRadius: 999, background: "rgba(120,120,140,.2)", overflow: "hidden" },
  fill: { height: "100%", background: "#0d8f9e", transition: "width .3s ease", borderRadius: 999 },
  fillPulse: { animation: "az-webml-pulse 1.1s ease-in-out infinite" },
  error: { padding: 12, borderRadius: 10, background: "rgba(189,46,72,.12)", color: "#bd2e48", fontSize: 13 },
  notice: { padding: 16, borderRadius: 12, background: "rgba(120,120,140,.1)", display: "flex", flexDirection: "column", gap: 6 },
  ghost: { padding: "10px 14px", borderRadius: 10, border: "1px solid rgba(120,120,140,.4)", background: "transparent", color: "inherit", fontSize: 14, cursor: "pointer" },
  log: { display: "flex", flexDirection: "column", gap: 10, minHeight: 160, maxHeight: 420, overflowY: "auto", padding: 4 },
  user: { alignSelf: "flex-end", background: "#0d8f9e", color: "#fff", padding: "8px 12px", borderRadius: 12, maxWidth: "80%", whiteSpace: "pre-wrap" },
  assistant: { alignSelf: "flex-start", background: "rgba(120,120,140,.14)", padding: "8px 12px", borderRadius: 12, maxWidth: "80%", whiteSpace: "pre-wrap" },
  inputRow: { display: "flex", gap: 8 },
  input: { flex: 1, padding: "10px 12px", borderRadius: 10, border: "1px solid rgba(120,120,140,.4)", background: "transparent", color: "inherit", fontSize: 14 },
};
