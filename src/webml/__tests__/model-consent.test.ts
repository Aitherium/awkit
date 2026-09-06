/**
 * @jest-environment jsdom
 */

/**
 * THE SDK LANE. awkit's `useWebGPUChat` ships to customer domains — a tenant appliance, an
 * ADK agent, a browser extension — and reaches the same multi-hundred-megabyte download as
 * the Living OS through code the Living OS's chokepoint cannot see.
 *
 * What it must NOT do is carry a host allowlist. The Living OS half knows it is
 * aitherium.com and refuses its own reading surfaces; awkit does not know whose site it is
 * on, and an aitherium.com allowlist compiled into an SDK would refuse every legitimate
 * customer host in silence — the inert-feature failure, shipped to people who paid for it.
 * So awkit owns exactly one question: **did a human agree?**
 *
 * The KEY is shared with the Living OS deliberately, and that is worth a test of its own:
 * same origin ⇒ one answer ⇒ a visitor who said yes in the OS is not asked again by an awkit
 * panel on that origin. Different origin ⇒ different localStorage ⇒ asked again, which is
 * correct, because consenting to one site is not consenting to another.
 */

import {
  MODEL_CONSENT_KEY,
  grantModelConsent,
  hasModelConsent,
  mayAutoLoadModel,
  readModelConsent,
  revokeModelConsent,
} from "../consent";

describe("awkit model consent", () => {
  beforeEach(() => window.localStorage.clear());

  it("shares the Living OS key, so one origin means one answer", () => {
    // Hardcoded on purpose: the CLAIM is that these two agree. Importing the Veil constant
    // would make the assertion circular, and awkit must not import from the app anyway.
    expect(MODEL_CONSENT_KEY).toBe("aitheros-bonsai-consent");
  });

  it("starts with nothing recorded", () => {
    expect(readModelConsent()).toBeNull();
    expect(hasModelConsent()).toBe(false);
    expect(mayAutoLoadModel()).toBe(false);
  });

  it("a bare yes is ONE download, not a standing permission", () => {
    grantModelConsent(false);
    expect(hasModelConsent()).toBe(true);
    expect(mayAutoLoadModel()).toBe(false);
  });

  it("the checkbox — and only the checkbox — enables an unattended load", () => {
    grantModelConsent(true);
    expect(mayAutoLoadModel()).toBe(true);
  });

  it("fails CLOSED on a malformed record — 'cannot read it' is not consent", () => {
    window.localStorage.setItem(MODEL_CONSENT_KEY, "{not json");
    expect(hasModelConsent()).toBe(false);
    window.localStorage.setItem(MODEL_CONSENT_KEY, JSON.stringify({ auto: true }));
    expect(hasModelConsent()).toBe(false);
    expect(mayAutoLoadModel()).toBe(false);
  });

  it("can be withdrawn — a permission a user cannot revoke is not a permission", () => {
    grantModelConsent(true);
    revokeModelConsent();
    expect(hasModelConsent()).toBe(false);
  });

  it("honours a yes written by the Living OS half — the shared key, end to end", () => {
    // Exactly the record `grantBonsaiConsent(true)` writes in AitherVeil.
    window.localStorage.setItem(
      MODEL_CONSENT_KEY,
      JSON.stringify({ granted: true, auto: true, at: new Date().toISOString() }),
    );
    expect(hasModelConsent()).toBe(true);
    expect(mayAutoLoadModel()).toBe(true);
  });
});
