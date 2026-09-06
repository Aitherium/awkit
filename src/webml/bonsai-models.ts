/**
 * Bonsai model catalog for portal-kit — portable across Veil, tenant agents, adk, and
 * other consumers. Each model declares its size, download cost, and device-memory
 * tier so consumers can suggest a default without downloading the wrong thing.
 *
 * All models are Q1_0 quantized (1 bit per weight) GGUF from prism-ml on HuggingFace.
 * Q2_0 (ternary) exists but requires new WebGPU kernels (future).
 *
 * Sizes (real blob sizes from HF API, 2026-07-26):
 *   1.7B  236 MB       4B  545 MB       8B  1.1 GB       27B  3.6 GB
 */

import { isMobileDevice } from "./device-class";

export interface BonsaiModelInfo {
  /** Stable ID used in model selectors and wire protocol. */
  id: string;
  /** Human label for the model picker. */
  label: string;
  /** Parameter count description (e.g. "1.7B", "4B"). */
  params: string;
  /** Real download size in MB — shown before first load. */
  sizeMb: number;
  /** GGUF URL — resolved from HuggingFace prism-ml repo. */
  url: string;
  /** Model's trained context window. Runtime may allocate less per device. */
  contextWindow: number;
  /** Plain-language guidance for the picker. */
  blurb: string;
  /**
   * GGUF `general.architecture` from the file metadata.
   * 'qwen3' = dense attention (1.7B/4B/8B).
   * 'qwen35' = DeltaNet + gated hybrid (27B only, reasoning model).
   * This is DESCRIPTIVE: runtime derives layer kinds from actual tensor shapes.
   */
  arch: "qwen3" | "qwen35";
}

/**
 * Upstream publisher. Kept ONLY to document where the weights originate and to
 * seed the mirror — it is NOT what browsers download from. See BONSAI_MIRROR.
 */
const HF_PRISM = "https://huggingface.co/prism-ml";

/**
 * The self-hosted weight mirror, and the ONLY host `resolveBonsaiUrl` hands out.
 *
 * A Cloudflare Worker over the `Aitherium/aitherkvcache` releases
 * (`bonsai-q1-v1`), serving `Bonsai-{1.7B,4B,8B}-Q1_0.gguf` directly and
 * stitching 27B from `.part{0,1,2}` because it exceeds GitHub's 2 GiB asset cap.
 * Flat bucket keyed by FILENAME — not HF's repo/resolve/branch path shape — so
 * anything that serves a file by name with Range + CORS can stand in.
 *
 * WHY THIS IS PRIMARY, NOT A FALLBACK. `resolveBonsaiUrl` returned the HF URL
 * and nothing else, so every browser consumer — the Living OS brain and, since
 * the X automation moved on-device, AitherConnect's poster and reply-planner —
 * downloaded from a third-party host we do not control. That host has already
 * gated this repo once: anonymous browsers got 401 and sat at "Brain loading…"
 * FOREVER, because there was no second path to try. The mirror was built to end
 * exactly that, and then was never wired into the resolver, so it protected
 * nothing. Measured 2026-08-02: all four models serve 206 + `Access-Control-
 * Allow-Origin` with identical byte counts from both hosts, so this switch is a
 * like-for-like swap onto infrastructure we own.
 *
 * Asserted by `AitherOS/dev/tools/check_bonsai_weight_lane.py`, which probes the
 * way a browser does (cross-origin + Range) rather than with a bare GET — a host
 * can answer curl and still be unusable from an extension.
 */
const BONSAI_MIRROR = "https://weights.aitherium.com";

export const BONSAI_MODELS_INFO: BonsaiModelInfo[] = [
  {
    id: "bonsai-1.7b",
    label: "Bonsai 1.7B",
    params: "1.7B",
    sizeMb: 236,
    url: `${HF_PRISM}/Bonsai-1.7B-gguf/resolve/main/Bonsai-1.7B-Q1_0.gguf`,
    contextWindow: 32768,
    blurb: "The lightest size — 236 MB, runs on phones and older laptops.",
    arch: "qwen3",
  },
  {
    id: "bonsai-4b",
    label: "Bonsai 4B",
    params: "4B",
    sizeMb: 545,
    url: `${HF_PRISM}/Bonsai-4B-gguf/resolve/main/Bonsai-4B-Q1_0.gguf`,
    contextWindow: 32768,
    blurb: "Balanced: smarter than 1.7B, quick to download and run.",
    arch: "qwen3",
  },
  {
    id: "bonsai-8b",
    label: "Bonsai 8B",
    params: "8B",
    sizeMb: 1104,
    url: `${HF_PRISM}/Bonsai-8B-gguf/resolve/main/Bonsai-8B-Q1_0.gguf`,
    contextWindow: 65536,
    blurb: "Better reasoning, ~1 GB. Desktop GPU recommended.",
    arch: "qwen3",
  },
  {
    id: "bonsai-27b-text",
    label: "Bonsai 27B (Reasoning)",
    params: "27B",
    sizeMb: 3627,
    url: `${HF_PRISM}/Bonsai-27B-gguf/resolve/main/Bonsai-27B-Q1_0.gguf`,
    contextWindow: 262144,
    blurb: "Full reasoning brain. 3.6 GB, needs a real desktop GPU.",
    arch: "qwen35",
  },
];

/**
 * Models runnable in the browser (all of them now, as of 2026-07-28).
 * Filter by architecture so a future addition stays out by default.
 */
export function browserRunnableBonsaiModels(): BonsaiModelInfo[] {
  return BONSAI_MODELS_INFO.filter((m) => ["qwen3", "qwen35"].includes(m.arch));
}

/** Default model when none is specified (balanced: smart enough, small enough). */
export const DEFAULT_BONSAI_MODEL_ID = "bonsai-4b";

export function getBonsaiModel(id: string): BonsaiModelInfo | undefined {
  return BONSAI_MODELS_INFO.find((m) => m.id === id);
}

/**
 * The URL a browser should download this model from: the self-hosted mirror.
 *
 * The catalogue's `url` records the upstream publisher; this is what actually
 * gets fetched. Consumers that want the upstream (a seeding script, an audit)
 * should read `.url` directly and say why.
 */
export function resolveBonsaiUrl(id: string): string {
  const m = getBonsaiModel(id) ?? getBonsaiModel(DEFAULT_BONSAI_MODEL_ID)!;
  return bonsaiMirrorUrl(m);
}

/** Mirror URL for a model — flat bucket, keyed by the upstream filename. */
export function bonsaiMirrorUrl(m: Pick<BonsaiModelInfo, "url">): string {
  const file = m.url.split("/").pop();
  if (!file) return m.url;
  return `${BONSAI_MIRROR.replace(/\/+$/, "")}/${file}`;
}

/**
 * Suggest a Bonsai size for this device.
 * A suggestion only — picker always wins. Errs small to avoid long waits.
 */
export function suggestBonsaiModelId(): string {
  if (typeof navigator === "undefined") return DEFAULT_BONSAI_MODEL_ID;

  const nav = navigator as Navigator & {
    deviceMemory?: number;
    connection?: { saveData?: boolean; effectiveType?: string };
  };

  // Respect Data Saver outright.
  if (nav.connection?.saveData) return "bonsai-1.7b";

  // 2G connections are too slow for larger models.
  const slowLink =
    nav.connection?.effectiveType && /2g/.test(nav.connection.effectiveType);
  if (slowLink) return "bonsai-1.7b";

  const mem = nav.deviceMemory ?? 4; // Chrome reports this; absent on Safari/FF
  // THE SHARED CHECK, not a fourth copy of the regex. This line was an inline
  // /Android|iPhone|iPad|iPod/ test, which misses every modern iPad: iPadOS 13+
  // sends a DESKTOP Safari UA containing "Macintosh", so a tablet was sized as a
  // desktop and — because Safari reports no deviceMemory — fell through to
  // DEFAULT_BONSAI_MODEL_ID (4B, 545 MB) where Veil's fixed copy gives it 1.7B
  // (236 MB). Veil's catalogue already carries this exact comment about its own
  // third copy; this was the fourth, invisible to BIH004 because that rule only
  // knew about two. BIH004 now discovers every copy instead.
  const mobile = isMobileDevice();
  if (mobile) return mem >= 6 ? "bonsai-4b" : "bonsai-1.7b";
  if (mem >= 8) return "bonsai-8b";
  return DEFAULT_BONSAI_MODEL_ID;
}

/**
 * Context window to allocate, RAM-tiered.
 * Never exceeds the model's trained window.
 */
export function pickBonsaiContext(model: BonsaiModelInfo): number {
  const mem =
    (typeof navigator !== "undefined" &&
      (navigator as Navigator & { deviceMemory?: number }).deviceMemory) ||
    4;
  const tier =
    mem >= 16 ? 32768 : mem >= 8 ? 16384 : mem >= 4 ? 8192 : 4096;
  return Math.min(tier, model.contextWindow);
}
