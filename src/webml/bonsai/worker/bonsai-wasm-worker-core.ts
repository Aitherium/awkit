// GENERATED — DO NOT EDIT.
// Synced from the canonical Bonsai webml runtime (the AitherVeil source
// tree in the AitherOS monorepo). Edit the canonical copy and re-run the
// sync; a hand edit here is overwritten on the next run.
/* SPDX-License-Identifier: LicenseRef-Aitherium-Proprietary
 * © 2026 Aitherium, LLC. Original work.
 *
 * THE WASM (CPU) LANE'S WORKER CORE — one implementation, both trees.
 *
 * MOVED HERE from `AitherVeil/src/components/os/webgpu-brain-wasm-worker.ts`, and the
 * move is the point. The WebGPU lane's core already lives in this directory and is
 * mirrored into the SDK package by the webml sync, so every consumer runs the same
 * decode loop. The wasm lane had no such core: it existed once, in Veil's components
 * directory, reachable by nothing else — so `useWebGPUChat` in the shared package had no
 * CPU lane at all and every non-Veil surface offered an iPhone visitor nothing.
 *
 * That asymmetry is exactly the shape this family of gates exists to close (BIH010: the
 * CPU lane must have a caller). A second hand-written copy in awkit would have "fixed"
 * it the way the runtime was fixed the first time — three copies, silently diverging, the
 * shared one missing every improvement.
 *
 * The entry files stay thin: they inject the environment (the wasm path, the worker
 * globals) and call `installWasmWorker`. All the behaviour is here.
 */

import type { WaspManifest } from "../wasp/manifest";
import type { RangeFetcher } from "../wasp/source";
import { loadModelViaWasp, type WllamaLike, type JspiHost } from "../wasp/sink-wasm";
import type { DirectoryHandleLike } from "../wasp/cache";

/** The message shapes the host and worker exchange. Structural, to avoid a package cycle. */
export interface WasmChatMessage {
  role: string;
  content: string;
}
export type WasmWorkerRequest =
  | { type: "load"; modelId: string }
  | { type: "generate"; messages: WasmChatMessage[]; maxTokens?: number; temperature?: number }
  | { type: "interrupt" }
  | { type: string; [k: string]: unknown };
export type WasmWorkerResponse =
  | { type: "error"; message: string }
  | { type: "progress"; progress: number; file?: string }
  | { type: "token"; text: string; channel: string }
  | { type: "done"; text: string; tokensPerSecond?: number }
  | { type: "ready"; modelId: string };

/** The wllama surface this core drives, plus the streaming chat call. */
export interface WasmRuntime extends WllamaLike {
  loadModelFromUrl?: (url: string, params?: unknown) => Promise<void>;
  createChatCompletion(params: Record<string, unknown>): Promise<unknown>;
  exit(): void;
}

export interface WasmWorkerEnv {
  /** Construct a fresh runtime. Called once per load so a failed load leaves nothing behind. */
  createRuntime: () => WasmRuntime;
  postMessage: (msg: WasmWorkerResponse) => void;
  /** Resolve a model id to its weight URL and byte length. */
  resolveModel: (modelId: string) => Promise<{ url: string; totalBytes: number }>;
  /** WASP transport. */
  fetchRange: (url: string) => RangeFetcher;
  /** The side-car, when one is served. */
  fetchManifest?: (url: string) => Promise<WaspManifest | null>;
  getDirectory?: () => Promise<DirectoryHandleLike>;
  global?: JspiHost;
  /**
   * Is this a mobile device? Injected rather than read from the REQUEST.
   *
   * 🚨 THE HOST MUST NOT BE THE ONE WHO DECIDES. A `mobile` flag on the generate message
   * makes the pacing depend on every caller remembering to send it, and a caller that
   * forgets does not get an error -- it gets a device that answers correctly and locks up
   * while doing it. Asked once per generation here, from the same shared predicate the
   * GPU lane uses (BIH004's subject: iPadOS sends a DESKTOP Safari UA, so a fresh regex
   * is wrong on every modern iPad).
   */
  isMobile?: () => boolean;
  log?: (msg: string) => void;
}

/**
 * PER-TOKEN YIELD ON MOBILE, unconditional.
 *
 * The WebGPU lane's freeze was an unbounded GPU queue. The wasm lane has no GPU queue and
 * froze anyway, for the sibling reason: a single-threaded decode inside a Worker never
 * returns to the event loop, so the worker cannot answer the host, the host's own
 * first-token deadline cannot fire, and the page has no way to tell "slow" from "dead".
 * Yielding once per token costs a fraction of a token's decode time and is what makes an
 * interrupt land.
 */
async function yieldToLoop(): Promise<void> {
  await new Promise<void>((r) => setTimeout(r, 0));
}

export interface InstalledWasmWorker {
  handle: (req: WasmWorkerRequest) => Promise<void>;
  /** For tests and teardown. */
  dispose: () => void;
}

export function installWasmWorker(env: WasmWorkerEnv): InstalledWasmWorker {
  const log = env.log ?? ((m: string) => console.info(m));
  let loaded: { runtime: WasmRuntime; modelId: string } | null = null;
  let abort: AbortController | null = null;

  const send = (msg: WasmWorkerResponse) => env.postMessage(msg);
  const fail = (message: string) => send({ type: "error", message });

  async function handleLoad(modelId: string): Promise<void> {
    try {
      if (loaded) {
        loaded.runtime.exit();
        loaded = null;
      }
      const { url, totalBytes } = await env.resolveModel(modelId);
      const runtime = env.createRuntime();
      const manifest = env.fetchManifest ? await env.fetchManifest(url) : null;

      const result = await loadModelViaWasp(
        runtime, url, totalBytes, env.fetchRange(url), manifest,
        { getDirectory: env.getDirectory, global: env.global, log },
        (bytes, total) => {
          const pct = total > 0 ? (bytes / total) * 100 : 0;
          send({ type: "progress", progress: Math.min(pct, 99.9), file: "Downloading model..." });
        },
      );
      if (!result.ok) {
        fail(`Failed to load model: ${result.reason}`);
        return;
      }
      loaded = { runtime, modelId };
      send({ type: "progress", progress: 100, file: "Model ready" });
      send({ type: "ready", modelId });
    } catch (error) {
      // NAMED, always. A memory-killed worker posts nothing and fires no error on several
      // engines (BIH001), so the errors we CAN report must never be swallowed into a
      // generic failure the host cannot tell from that silence.
      fail(`Failed to load model: ${error instanceof Error ? error.message : String(error)}`);
      loaded = null;
    }
  }

  async function handleGenerate(
    messages: WasmChatMessage[], maxTokens = 512, temperature = 0.7,
  ): Promise<void> {
    // ONCE PER GENERATION, and from the environment rather than the message. It cannot
    // change mid-turn, and a per-token read would call navigator on every token.
    const mobile = env.isMobile ? env.isMobile() : false;
    if (!loaded) {
      fail("Model not loaded. Call load first.");
      return;
    }
    abort = new AbortController();
    const started = Date.now();
    let fullText = "";
    let tokens = 0;
    const pending: Array<Promise<void>> = [];
    try {
      // ONE options object, not (body, options). wllama's createChatCompletion takes a
      // single ChatCompletionParams & StreamParams argument; the two-argument OpenAI-SDK
      // shape compiled only under ignoreBuildErrors and at runtime the second argument
      // was silently DISCARDED -- `stream` stayed unset, onData never fired, and the CPU
      // lane answered every prompt with an empty reply while reporting success.
      await loaded.runtime.createChatCompletion({
        messages: formatMessages(messages),
        max_tokens: maxTokens,
        temperature,
        abortSignal: abort.signal,
        stream: true,
        onData: (chunk: { choices?: Array<{ delta?: { content?: string | null } }> }) => {
          if (abort?.signal.aborted) return;
          const token = chunk.choices?.[0]?.delta?.content;
          if (!token) return;
          fullText += token;
          tokens += 1;
          send({ type: "token", text: token, channel: "answer" });
          if (mobile) pending.push(yieldToLoop());
        },
      });
      await Promise.all(pending);
      const secs = (Date.now() - started) / 1000;
      send({ type: "done", text: fullText, tokensPerSecond: secs > 0 ? tokens / secs : 0 });
    } catch (error) {
      if (abort?.signal.aborted) {
        send({ type: "done", text: "", tokensPerSecond: 0 });
      } else {
        fail(`Generation failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    } finally {
      abort = null;
    }
  }

  return {
    async handle(req: WasmWorkerRequest): Promise<void> {
      switch (req.type) {
        case "load":
          await handleLoad(String((req as { modelId: string }).modelId));
          break;
        case "generate": {
          const r = req as {
            messages: WasmChatMessage[]; maxTokens?: number; temperature?: number;
          };
          await handleGenerate(r.messages, r.maxTokens, r.temperature);
          break;
        }
        case "interrupt":
          abort?.abort();
          break;
        default:
          break;
      }
    },
    dispose() {
      abort?.abort();
      if (loaded) {
        loaded.runtime.exit();
        loaded = null;
      }
    },
  };
}

/**
 * Narrow to the three plain roles, in the TYPE and at RUNTIME.
 *
 * wllama's ChatCompletionMessage is a discriminated union whose 'tool' arm requires a
 * tool_call_id, so a 'tool' turn passed through verbatim fails the template.
 */
export function formatMessages(
  messages: WasmChatMessage[],
): Array<{ role: "system" | "user" | "assistant"; content: string }> {
  return messages
    .filter((m): m is WasmChatMessage & { role: "system" | "user" | "assistant" } =>
      m.role === "system" || m.role === "user" || m.role === "assistant")
    .map((m) => ({ role: m.role, content: m.content }));
}
