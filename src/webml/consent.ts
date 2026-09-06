/* SPDX-License-Identifier: LicenseRef-Aitherium-Proprietary
 * © 2026 Aitherium, LLC. Original work.
 *
 * CONSENT TO DOWNLOAD A MODEL — the awkit half.
 *
 * A model load here is 236 MB to 3.6 GB onto someone's device and sustained work on their
 * GPU. Nothing in this package may begin that because a component mounted.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO: decide WHERE a model may run. The Living OS half
 * (`AitherVeil/src/lib/bonsai-consent.ts`) carries a host allowlist and a path denylist,
 * because it knows it is aitherium.com and knows which of its own routes are reading
 * surfaces. awkit ships to other people's domains — `garg.aitherium.com`, a customer
 * appliance, an ADK agent, a browser extension — and a hardcoded aitherium.com allowlist
 * there would refuse every legitimate host in silence. Surface policy belongs to whoever
 * mounts the component; this module owns the question that is the same everywhere: **did a
 * human agree?**
 *
 * The KEY is shared with the Living OS on purpose. Same origin ⇒ same answer, so a visitor
 * who said yes in the OS is not asked again by an awkit panel on that origin. Different
 * origin ⇒ different localStorage ⇒ asked again, which is correct: consenting to one site
 * is not consenting to another.
 *
 * Asserted by `check_bonsai_consent_gate.py` (BCG008), which also pins that this key equals
 * the Living OS one — two copies of a rule set drift, and a comment is not a gate.
 *
 * One thing this module DOES own beyond consent, because it is the same everywhere a phone
 * is: the owner directive of 2026-09-01 — a PHONE may not load any in-browser model, tap or
 * auto, consented or not (even the 1.7B on the CPU lane froze a Pixel 10 to a reboot).
 * Surface policy still belongs to the mount site; the device safety gate does not.
 */

import { isPhoneDevice } from "./device-class";

/** Shared with AitherVeil's `BONSAI_CONSENT_KEY`. Same origin, same answer. */
export const MODEL_CONSENT_KEY = "aitheros-bonsai-consent";

export interface ModelConsent {
  /** A human agreed to download and run a model on this device. */
  granted: boolean;
  /** ...and ticked "load automatically from now on". Unattended loads need THIS. */
  auto: boolean;
  /** ISO timestamp, so a stale grant is at least visible. */
  at: string;
}

/**
 * The stored answer, or null if never asked.
 *
 * Fails CLOSED on anything unexpected — SSR, disabled storage, malformed JSON, an older
 * shape. "I could not read the consent" is not consent.
 */
export function readModelConsent(): ModelConsent | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(MODEL_CONSENT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ModelConsent>;
    if (parsed?.granted !== true) return null;
    return { granted: true, auto: parsed.auto === true, at: String(parsed.at ?? "") };
  } catch {
    return null;
  }
}

/** Has a human agreed at all, on this device? */
export function hasModelConsent(): boolean {
  return readModelConsent() !== null;
}

/**
 * May a model load with NO interaction on this visit?
 *
 * Requires the checkbox, not merely a past yes. A bare `granted` was permission for ONE
 * download; treating it as standing is how a single tap becomes a download on every future
 * page load — the defect this file exists to end.
 */
export function mayAutoLoadModel(): boolean {
  // Phones may never auto-load (owner directive 2026-09-01) — an unattended lane has no
  // click and no prompt behind it, so the gate must be a hard no before the consent read.
  if (isPhoneDevice()) return false;
  return readModelConsent()?.auto === true;
}

/** Record the answer. `auto` is the checkbox. */
export function grantModelConsent(auto: boolean): ModelConsent {
  const consent: ModelConsent = { granted: true, auto, at: new Date().toISOString() };
  try {
    window.localStorage.setItem(MODEL_CONSENT_KEY, JSON.stringify(consent));
  } catch {
    /* private mode: the session still proceeds, it is just not remembered */
  }
  return consent;
}

/**
 * Withdraw it.
 *
 * Note there is deliberately no way to persist a NO. A refusal remembered forever is how a
 * mis-click costs someone the feature with no route back, and it is not information anyone
 * needs to keep — an unanswered gate already refuses.
 */
export function revokeModelConsent(): void {
  try {
    window.localStorage.removeItem(MODEL_CONSENT_KEY);
  } catch {
    /* nothing to undo */
  }
}
