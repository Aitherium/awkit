// GENERATED — DO NOT EDIT.
// Synced from the canonical Bonsai webml runtime (the AitherVeil source
// tree in the AitherOS monorepo). Edit the canonical copy and re-run the
// sync; a hand edit here is overwritten on the next run.
/* SPDX-License-Identifier: LicenseRef-Aitherium-Proprietary
 * © 2026 Aitherium, LLC. Original work.
 *
 * WASP BUDGET — what THIS device can actually hold, decided before anything is fetched.
 *
 * THE SHAPE OF THE OLD ANSWER, AND WHY IT WAS WRONG IN THREE PLACES AT ONCE.
 *
 *  1. `kvBudgetBytes(deviceMemoryGb)` sized the KV cache from `navigator.deviceMemory`
 *     alone — a number Chrome CAPS AT 8, reports as SYSTEM RAM rather than anything the
 *     GPU can have, and Safari and Firefox omit entirely. Every non-Chromium visitor got
 *     the conservative floor, which is defensible; every phone got a number derived from
 *     how much RAM the whole handset has, which is not.
 *  2. `gpuSizeCeilingMb(gpu)` sized the WEIGHTS from the adapter's VENDOR STRING. On
 *     mobile there is no vendor string (Safari exposes no `GPUAdapterInfo` at all), so
 *     the mobile branch is keyed on `isMobileDevice()` — correct, and completely blind to
 *     how big the device actually is: a 2 GB Android and a 16 GB iPad Pro get one answer.
 *  3. NOBODY ASKED THE ADAPTER. `adapter.limits.maxBufferSize` and
 *     `maxStorageBufferBindingSize` are the two numbers that decide whether a tensor can
 *     be bound at all, and the only places they appeared in this runtime were a type
 *     declaration (`gpu-min.ts`) and a log line (`real-model-harness-entry.ts`). The
 *     device cannot be asked instead: a `GPUDevice` reports the limits it was CREATED
 *     with, so it answers with a number the caller itself picked.
 *
 * SO THE BUDGET IS A UNION OF SIGNALS, EACH USED FOR WHAT IT KNOWS:
 *   adapter limits  -> the largest single BUFFER (a hard ceiling, not a heuristic)
 *   deviceMemory    -> a coarse RAM class on Chromium
 *   storage quota   -> whether the weights can even be cached
 *   UA class        -> the only thing Safari tells us, and on iOS it is decisive
 *
 * 🚨 THE SAFARI HEURISTICS ARE NUMBERS, NOT PRINCIPLES. WebKit's jetsam daemon kills a
 * tab well under the device's RAM and publishes no limit, so "iPhone ≤ 1 GiB" is a
 * measured-elsewhere convention, not a derivation. It is written as a named constant with
 * this sentence attached so the next person changes it deliberately instead of assuming
 * it came from somewhere.
 */

import { WASP_CHUNK_TARGET_BYTES } from "./index";
import {
  adapterBufferCeiling,
  type AdapterLimitsLike,
} from "./sink-webgpu";

const MB = 1024 * 1024;
const GB = 1024 * MB;

export type WaspLane = "webgpu" | "wasm";
export type WaspDeviceClass = "iphone" | "ipad" | "android-phone" | "android-tablet" | "desktop";

export interface WaspBudget {
  /** Which lane this device should take. */
  lane: WaspLane;
  deviceClass: WaspDeviceClass;
  /** Bytes available for WEIGHTS. `Infinity` on desktop, as before. */
  weightsBytes: number;
  /** Bytes available for the KV cache. */
  kvBytes: number;
  /** The largest single GPU buffer this adapter will bind. */
  maxTensorBytes: number;
  /** The range/chunk size to read at. */
  chunkBytes: number;
  /** Storage quota, if the browser reports one. */
  storageQuotaBytes: number | null;
  /** Which signals were actually available — so a verdict can be explained, not guessed. */
  signals: {
    deviceMemoryGb: number | null;
    hardwareConcurrency: number | null;
    adapterLimitsRead: boolean;
  };
  /** One line saying why, for the log. An unexplained refusal is a bug report. */
  reason: string;
}

/** Everything the budget reads from the environment. Injectable, so the tests are real. */
export interface BudgetEnv {
  userAgent?: string;
  maxTouchPoints?: number;
  deviceMemory?: number;
  hardwareConcurrency?: number;
  adapterLimits?: AdapterLimitsLike | null;
  storageQuotaBytes?: number | null;
}

/**
 * iPhone. WebKit's jetsam kills a tab far below the handset's RAM and publishes no
 * number, so this is a convention rather than a derivation — see the header.
 */
export const IPHONE_TOTAL_BYTES = 1 * GB;
/** iPad. Same source, more headroom; iPadOS raises the per-tab allowance. */
export const IPAD_TOTAL_BYTES = 2 * GB;
/** Android phone: a quarter of reported RAM, capped. Chrome reports SYSTEM memory. */
export const ANDROID_PHONE_RAM_FRACTION = 0.25;
export const ANDROID_PHONE_CAP_BYTES = 2 * GB;
/** What a mobile budget reserves for KV out of its total. The rest is weights. */
export const MOBILE_KV_FRACTION = 0.25;

/** Desktop KV floor/ceiling — the behaviour `kvBudgetBytes` had, preserved exactly. */
export const DESKTOP_KV_FLOOR_BYTES = 256 * MB;
export const DESKTOP_KV_CEIL_BYTES = 1024 * MB;

/**
 * Classify the device from the UA.
 *
 * The iPadOS branch is the half everyone omits: iPadOS 13+ sends a DESKTOP Safari UA
 * containing "Macintosh", so a plain regex misses every modern iPad — precisely the class
 * a budget exists for. Kept in step with `isMobileDevice()` / `isPhoneDevice()` in
 * gpu-class.ts and device-class.ts, which BIH004 byte-compares.
 */
export function classifyDevice(env: BudgetEnv): WaspDeviceClass {
  const ua = env.userAgent ?? "";
  const touch = env.maxTouchPoints ?? 0;
  if (/iPhone|iPod/i.test(ua)) return "iphone";
  if (/iPad/i.test(ua)) return "ipad";
  if (/Macintosh/i.test(ua) && touch > 1) return "ipad"; // iPadOS 13+ desktop UA
  if (/Android/i.test(ua)) return /Mobile/i.test(ua) ? "android-phone" : "android-tablet";
  return "desktop";
}

/**
 * The budget for this device.
 *
 * `adapter` is the GPUAdapter's `limits`, NOT a device's. Pass it when one has been
 * requested; when it is absent the ceiling falls back to WebGPU's 128 MiB spec default
 * rather than to Infinity — the browsers that report nothing are exactly the ones that
 * cannot afford an optimistic guess.
 */
export function deviceBudget(env: BudgetEnv = {}): WaspBudget {
  const deviceClass = classifyDevice(env);
  const maxTensorBytes = adapterBufferCeiling(env.adapterLimits);
  const deviceMemoryGb = typeof env.deviceMemory === "number" && env.deviceMemory > 0
    ? env.deviceMemory : null;
  const signals = {
    deviceMemoryGb,
    hardwareConcurrency: typeof env.hardwareConcurrency === "number"
      ? env.hardwareConcurrency : null,
    adapterLimitsRead: !!(env.adapterLimits
      && (env.adapterLimits.maxBufferSize || env.adapterLimits.maxStorageBufferBindingSize)),
  };
  const storageQuotaBytes = typeof env.storageQuotaBytes === "number"
    ? env.storageQuotaBytes : null;
  const base = {
    deviceClass, maxTensorBytes, chunkBytes: WASP_CHUNK_TARGET_BYTES,
    storageQuotaBytes, signals,
  };

  if (deviceClass === "desktop") {
    // UNCHANGED on desktop, deliberately. The whole front is behaviour-neutral off
    // mobile, and a budget that quietly tightened a working desktop would be a
    // regression nobody asked for, discovered by someone whose 27B stopped loading.
    return {
      ...base,
      lane: "webgpu",
      weightsBytes: Infinity,
      kvBytes: kvBudgetFromDeviceMemory(deviceMemoryGb),
      reason: `desktop: weights uncapped, KV ${Math.round(
        kvBudgetFromDeviceMemory(deviceMemoryGb) / MB)} MB`,
    };
  }

  let total: number;
  let why: string;
  if (deviceClass === "iphone") {
    total = IPHONE_TOTAL_BYTES;
    why = "iPhone: WebKit jetsam caps a tab well below handset RAM and publishes no limit";
  } else if (deviceClass === "ipad") {
    total = IPAD_TOTAL_BYTES;
    why = "iPad: iPadOS raises the per-tab allowance over iPhone";
  } else if (deviceMemoryGb !== null) {
    total = Math.min(ANDROID_PHONE_CAP_BYTES,
      Math.floor(deviceMemoryGb * GB * ANDROID_PHONE_RAM_FRACTION));
    why = `Android: min(0.25 x ${deviceMemoryGb} GB reported RAM, 2 GiB)`;
  } else {
    // Android with no deviceMemory (Firefox mobile). The conservative floor is the
    // iPhone budget: guessing high here costs a killed tab, guessing low costs a
    // smaller model on a picker that still lets the visitor choose.
    total = IPHONE_TOTAL_BYTES;
    why = "Android, no deviceMemory reported: conservative floor";
  }

  const kvBytes = Math.floor(total * MOBILE_KV_FRACTION);
  return {
    ...base,
    // iOS WebGPU is BANNED this front (see WASP_PHONE_RATCHET), and an Android phone's
    // lane is decided by the ratchet too — the budget says what FITS, never what is
    // ALLOWED. Reporting `wasm` here is the honest default for a device whose GPU lane
    // has not been verified; the gate sites are what actually refuse.
    lane: "wasm",
    weightsBytes: total - kvBytes,
    kvBytes,
    reason: `${why}; ${Math.round((total - kvBytes) / MB)} MB weights + `
      + `${Math.round(kvBytes / MB)} MB KV, largest bindable tensor `
      + `${Math.round(maxTensorBytes / MB)} MB`,
  };
}

/**
 * The desktop KV budget, byte-for-byte what `kvBudgetBytes` computed.
 *
 * Kept as its own function and re-exported from `model/kv-capacity.ts` so the KV planner
 * keeps ONE source for this number. Copying it would be the drift this plane exists to
 * stop: two answers to "how much KV can this device afford" is how a feature ships
 * switched on and inert.
 */
export function kvBudgetFromDeviceMemory(deviceMemoryGb?: number | null): number {
  if (!deviceMemoryGb || !Number.isFinite(deviceMemoryGb) || deviceMemoryGb <= 0) {
    return DESKTOP_KV_FLOOR_BYTES;
  }
  return Math.max(DESKTOP_KV_FLOOR_BYTES,
    Math.min(DESKTOP_KV_CEIL_BYTES, Math.floor(deviceMemoryGb * 128 * MB)));
}

/** The subset of a catalogue entry `selectPlan` needs. */
export interface PlanCandidate {
  id: string;
  sizeMb: number;
  /** From the file's manifest when one is served; unknown otherwise. */
  largestTensorGpuBytes?: number;
}

export interface WaspPlan {
  /** The chosen model, or null when nothing in the catalogue fits. */
  id: string | null;
  lane: WaspLane;
  /** Positions of KV this budget affords, given bytes per position. */
  kvPositions: number;
  reason: string;
}

/**
 * Pick the largest model this budget can carry.
 *
 * `sizeMb * 1.2` is the download plus its working overhead, not a safety factor picked
 * for comfort: the weights land in a GPU buffer AND the repacked chunk is resident while
 * it is written, and the runtime's own allocations sit beside both.
 *
 * A candidate with a KNOWN `largestTensorGpuBytes` that exceeds `maxTensorBytes` is
 * rejected outright however small the file is — that is the number the adapter actually
 * refuses on, and a 500 MB model with one 200 MB tensor fails on a device that would have
 * carried a 2 GB model made of small ones.
 */
export function selectPlan(
  candidates: readonly PlanCandidate[],
  budget: WaspBudget,
  opts: { bytesPerPosition?: number; kvCeiling?: number } = {},
): WaspPlan {
  const affordable = candidates
    .filter((c) => {
      if (c.largestTensorGpuBytes !== undefined
          && c.largestTensorGpuBytes > budget.maxTensorBytes) return false;
      return c.sizeMb * 1.2 * MB <= budget.weightsBytes;
    })
    .sort((a, b) => b.sizeMb - a.sizeMb);

  const bpp = opts.bytesPerPosition ?? 0;
  const ceiling = opts.kvCeiling ?? Number.MAX_SAFE_INTEGER;
  const kvPositions = bpp > 0
    ? Math.min(ceiling, Math.floor(budget.kvBytes / bpp))
    : ceiling;

  if (affordable.length === 0) {
    const smallest = [...candidates].sort((a, b) => a.sizeMb - b.sizeMb)[0];
    return {
      id: null,
      lane: budget.lane,
      kvPositions,
      reason: smallest
        ? `nothing fits: the smallest candidate (${smallest.id}, ${smallest.sizeMb} MB) `
          + `needs ${Math.round(smallest.sizeMb * 1.2)} MB and the budget affords `
          + `${Math.round(budget.weightsBytes / MB)} MB`
        : "no candidates offered",
    };
  }
  const picked = affordable[0];
  return {
    id: picked.id,
    lane: budget.lane,
    kvPositions,
    reason: `${picked.id} (${picked.sizeMb} MB) of ${candidates.length} candidate(s); `
      + `${budget.reason}`,
  };
}
