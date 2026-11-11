import { describe, expect, test } from "bun:test";
import { takeIpToken, type RapidAPIState } from "../netlify/edge-functions/stream";

const freshState = (): RapidAPIState => ({ keys: [], ips: {} });

describe("takeIpToken", () => {
  test("allows a burst of eight resolutions for a fresh client", () => {
    const state = freshState();
    const results = Array.from({ length: 8 }, () =>
      takeIpToken(state, "203.0.113.7", 1_000),
    );
    expect(results.every((r) => r.allowed)).toBe(true);
    expect(results[0].retryAfter).toBe(0);
  });

  test("refuses the ninth immediate resolution with a retry hint", () => {
    const state = freshState();
    for (let i = 0; i < 8; i++) takeIpToken(state, "203.0.113.7", 1_000);

    const blocked = takeIpToken(state, "203.0.113.7", 1_000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfter).toBe(10);
    expect(blocked.record.totalViolations).toBe(1);
    expect(state.ips["203.0.113.7"].totalViolations).toBe(1);
  });

  test("keeps clients independent and ignores their neighbours' budget", () => {
    const state = freshState();
    for (let i = 0; i < 8; i++) takeIpToken(state, "203.0.113.7", 1_000);

    expect(takeIpToken(state, "203.0.113.8", 1_000).allowed).toBe(true);
  });

  test("refills one token per ten seconds", () => {
    const state = freshState();
    for (let i = 0; i < 8; i++) takeIpToken(state, "203.0.113.7", 1_000);

    expect(takeIpToken(state, "203.0.113.7", 5_000).allowed).toBe(false);
    expect(takeIpToken(state, "203.0.113.7", 11_000).allowed).toBe(true);
    expect(takeIpToken(state, "203.0.113.7", 11_000).allowed).toBe(false);
  });

  test("does not accumulate tokens beyond the burst capacity while idle", () => {
    const state = freshState();
    takeIpToken(state, "203.0.113.7", 0);
    const afterIdle = Array.from({ length: 9 }, () =>
      takeIpToken(state, "203.0.113.7", 24 * 60 * 60 * 1000),
    );
    expect(afterIdle.filter((r) => r.allowed)).toHaveLength(8);
  });

  test("treats records written before the bucket existed as a full burst", () => {
    const state: RapidAPIState = {
      keys: [],
      ips: { "203.0.113.7": { lastSeen: 0, totalViolations: 3 } },
    };
    const first = takeIpToken(state, "203.0.113.7", 1_000);
    expect(first.allowed).toBe(true);
    expect(first.record.tokens).toBe(7);
  });

  test("works without a persisted state", () => {
    const gate = takeIpToken(null, "203.0.113.7", 1_000);
    expect(gate.allowed).toBe(true);
  });
});
