// GENERATED — DO NOT EDIT.
// Synced from the canonical Bonsai webml runtime (the AitherVeil source
// tree in the AitherOS monorepo). Edit the canonical copy and re-run the
// sync; a hand edit here is overwritten on the next run.
/* SPDX-License-Identifier: LicenseRef-Aitherium-Proprietary
 * © 2026 Aitherium, LLC. Original work.
 *
 * HOW MANY KV POSITIONS TO ALLOCATE FOR A TURN — and why a constant could not work.
 *
 * Cross-turn prefix reuse (model/prefix-cache.ts) only engages if the CURRENT turn fits in
 * the buffers the PREVIOUS turn allocated. Capacity was `promptLen + maxTokens + 1 + 512`,
 * with 512 a fixed REUSE_HEADROOM, and measured live on 2026-07-31 that made reuse inert in
 * production rather than merely unlikely:
 *
 *     [bonsai] prefix reuse: none — turn needs 2822 positions but the cache holds 2232
 *
 * The greeter sends a ~1290-token prompt and `maxTokens: 1536`, so turn 2's prompt has grown
 * by turn 1's reply plus the new question — past 512 — and the planner correctly refuses,
 * every single turn, forever. The feature shipped switched on and did nothing, and the cost
 * is a full ~1285-token re-prefill (~4.5 s) on every reply.
 *
 * WHY NOT JUST RAISE THE CONSTANT. KV is expensive and the price differs per model: bytes
 * per position is `fullAttnLayers x 2 x headCountKv x headDim x 4`, which is ~288 KB on the
 * dense 4B (36 layers) and ~229 KB on the 1.7B (28 layers). Reserving another full
 * `maxTokens` of headroom is ~450 MB on the 4B — nothing on a 5090, fatal on a phone, and
 * phones are the devices the small sizes exist to serve. A single number cannot be right for
 * both, which is exactly why 512 was chosen and why it was too small to work.
 *
 * So headroom is what the DEVICE can afford, computed from real geometry:
 *   - ask for enough to cover the growth between turns (a reply, plus a new question);
 *   - grant only what fits a memory budget derived from `navigator.deviceMemory`;
 *   - never allocate MORE than the turn already required, so this can only add headroom
 *     that is affordable and can never make a device worse off than the old constant.
 *
 * Pure and GPU-free on purpose — this is the decision, and it is the part worth testing.
 */

export interface KvGeometry {
  /** Layers that actually carry a KV cache. On a hybrid (27B) most layers do NOT. */
  fullAttnLayerCount: number;
  headCountKv: number;
  headDim: number;
}

/** Bytes of KV cache one position costs: K and V for every attention layer.
 *  `bytesPerElement` is 4 for the F32 cache (default) and 0.5 for the gated 4-bit cache
 *  (4 bits per element + one f16 scale per (pos, kv_head) row amortised over headDim).
 */
export function kvBytesPerPosition(g: KvGeometry, bytesPerElement = 4.0): number {
  return g.fullAttnLayerCount * 2 * g.headCountKv * g.headDim * bytesPerElement;
}

/**
 * A KV memory budget for this device, in bytes.
 *
 * `navigator.deviceMemory` is coarse (Chrome caps it at 8, reports SYSTEM RAM not VRAM, and
 * Firefox/Safari omit it entirely) — but it is the only signal a page gets, and a coarse
 * signal beats a constant that is wrong on every device. The fraction is deliberately small:
 * the weights, the activations and the browser itself also live in that memory, and the
 * failure mode of guessing high is an allocation error mid-turn, not a slow turn.
 *
 * Unknown -> the conservative floor, which is the case every non-Chromium visitor gets.
 */
export function kvBudgetBytes(deviceMemoryGb?: number): number {
  const MB = 1024 * 1024;
  const FLOOR = 256 * MB;   // what we assume when the browser tells us nothing
  const CEIL = 1024 * MB;   // never reserve more than this for KV, however big the machine
  if (!deviceMemoryGb || !Number.isFinite(deviceMemoryGb) || deviceMemoryGb <= 0) return FLOOR;
  return Math.max(FLOOR, Math.min(CEIL, Math.floor(deviceMemoryGb * 128 * MB)));
}

export interface KvPlanInput {
  promptLen: number;
  maxTokens: number;
  /** Hard ceiling on context (KV_CEILING). */
  ceiling: number;
  bytesPerPosition: number;
  budgetBytes: number;
  /** False when cross-turn reuse is off — then headroom is pure waste. */
  reuseEnabled: boolean;
}

export interface KvPlan {
  capacity: number;
  headroom: number;
  /** Why this much — logged, so an inert feature is visible instead of silent. */
  reason: string;
}

/**
 * A new question is short. Reserving room for one costs ~70 MB on the 4B and is what lets a
 * conversation keep reusing its prefix rather than only surviving a single follow-up.
 */
const QUESTION_ALLOWANCE = 256;

export function planKvCapacity(input: KvPlanInput): KvPlan {
  const { promptLen, maxTokens, ceiling, bytesPerPosition, budgetBytes, reuseEnabled } = input;
  // What THIS turn cannot do without. +1 for the `</think>` the loop may feed itself.
  const required = promptLen + maxTokens + 1;

  if (!reuseEnabled) {
    return {
      capacity: Math.min(ceiling, required),
      headroom: 0,
      reason: 'reuse disabled — no headroom charged',
    };
  }

  // Turn 2's prompt = this prompt + this reply + a new question. The reply can be up to
  // maxTokens, so that is the honest ask; whether we GET it depends on the budget.
  const wanted = maxTokens + QUESTION_ALLOWANCE;

  if (bytesPerPosition <= 0) {
    return { capacity: Math.min(ceiling, required), headroom: 0, reason: 'unknown KV geometry' };
  }

  const affordablePositions = Math.floor(budgetBytes / bytesPerPosition);
  // Headroom is only ever what is left AFTER the turn's own requirement. If the requirement
  // alone already exceeds the budget we grant zero and allocate exactly what the turn needs —
  // identical to the old behaviour, so this can never regress a constrained device.
  const spare = Math.max(0, affordablePositions - required);
  const headroom = Math.min(wanted, spare);
  const capacity = Math.min(ceiling, required + headroom);

  const mb = (n: number) => Math.round((n * bytesPerPosition) / (1024 * 1024));
  const reason = headroom <= 0
    ? `no headroom — turn needs ${required} positions (${mb(required)} MB) and the budget `
      + `affords ${affordablePositions}; cross-turn reuse will not engage`
    : `headroom ${headroom} of ${wanted} wanted (${mb(capacity)} MB total, budget affords `
      + `${affordablePositions} positions)`;

  return { capacity, headroom, reason };
}
