import { describe, expect, test } from "bun:test";
import {
  historyFingerprint,
  mergeUnique,
  rankCandidates,
  selectSeeds,
} from "../src/modules/homeFeedRanking";

const track = (
  id: string,
  author: string,
  duration = "5:00",
  authorId = author,
): YTItem => ({
  id,
  title: `Title ${id}`,
  author,
  authorId,
  duration,
  type: "video",
});

const empty = new Set<string>();

describe("historyFingerprint", () => {
  test("changes when the newest history changes", () => {
    const a = historyFingerprint(["a", "b"]);
    const b = historyFingerprint(["c", "b"]);
    const c = historyFingerprint(["a", "b", "c"]);
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
    expect(a).toBe(historyFingerprint(["a", "b"]));
  });
});

describe("selectSeeds", () => {
  const history = [
    track("s1", "A"),
    track("s2", "B"),
    track("s3", "A"),
    track("s4", "C"),
    track("s5", "D"),
  ];

  test("uses distinct authors and 3/2/1 weights", () => {
    const result = selectSeeds(history, empty, 3, 0);
    expect(result.seeds.map((seed) => seed.id)).toEqual(["s1", "s2", "s4"]);
    expect(result.seeds.map((seed) => seed.weight)).toEqual([3, 2, 1]);
    expect(result.nextCursor).toBe(3);
    expect(result.exhausted).toBe(false);
  });

  test("skips banned authors without stalling the cursor", () => {
    const result = selectSeeds(history, new Set(["B"]), 3, 0);
    expect(result.seeds.map((seed) => seed.id)).toEqual(["s1", "s4", "s5"]);
    expect(result.nextCursor).toBe(4);
    expect(result.exhausted).toBe(true);
  });

  test("loads older seeds from the cursor", () => {
    const first = selectSeeds(history, empty, 2, 0);
    expect(first.seeds.map((seed) => seed.id)).toEqual(["s1", "s2"]);
    expect(first.nextCursor).toBe(2);

    const next = selectSeeds(history, empty, 2, first.nextCursor);
    expect(next.seeds.map((seed) => seed.id)).toEqual(["s4", "s5"]);
    expect(next.exhausted).toBe(true);
  });

  test("returns empty and exhausted at the end", () => {
    const result = selectSeeds(history, empty, 3, 99);
    expect(result.seeds).toHaveLength(0);
    expect(result.exhausted).toBe(true);
  });
});

describe("rankCandidates", () => {
  const groups = [
    { seed: { id: "s1", title: "A", author: "A", authorId: "A", weight: 3 }, items: [track("a1", "A"), track("a2", "A"), track("a3", "A")] },
    { seed: { id: "s2", title: "B", author: "B", authorId: "B", weight: 2 }, items: [track("b1", "B"), track("b2", "B")] },
    { seed: { id: "s3", title: "C", author: "C", authorId: "C", weight: 1 }, items: [track("c1", "C")] },
  ];

  const options = {
    history: empty,
    hidden: empty,
    banned: empty,
    perChannel: 99,
  };

  test("interleaves by weight", () => {
    const result = rankCandidates(groups, options);
    expect(result.map((item) => item.id)).toEqual([
      "a1",
      "a2",
      "a3",
      "b1",
      "b2",
      "c1",
    ]);
  });

  test("caps channels, removes history/current, and dedupes", () => {
    const result = rankCandidates(
      [
        {
          seed: { id: "s1", title: "A", author: "A", authorId: "A", weight: 3 },
          items: [
            track("a1", "A", "5:00", "chanA"),
            track("a2", "A", "5:00", "chanA"),
            track("a3", "A", "5:00", "chanA"),
            track("b1", "B", "5:00", "chanA"),
            track("a1", "A", "5:00", "chanA"),
          ],
        },
      ],
      {
        history: new Set(["a3"]),
        hidden: new Set(["a2"]),
        banned: empty,
        currentId: "b1",
      },
    );
    expect(result.map((item) => item.id)).toEqual(["a1"]);
  });

  test("enforces duration bounds and max", () => {
    const result = rankCandidates(
      [
        {
          seed: { id: "s1", title: "A", author: "A", authorId: "A", weight: 3 },
          items: [
            track("short", "A", "0:30"),
            track("ok", "B", "1:00"),
            track("long", "C", "4:00:01"),
            track("max", "D", "4:00:00"),
            track("extra", "E", "5:00"),
          ],
        },
      ],
      { ...options, max: 2 },
    );
    expect(result.map((item) => item.id)).toEqual(["ok", "max"]);
  });

  test("counts existing channel usage", () => {
    const result = rankCandidates(
      [
        {
          seed: { id: "s1", title: "A", author: "A", authorId: "A", weight: 3 },
          items: [track("a1", "A", "5:00", "chanA")],
        },
      ],
      {
        ...options,
        perChannel: 2,
        existing: [track("old1", "A", "5:00", "chanA"), track("old2", "A", "5:00", "chanA")],
      },
    );
    expect(result).toHaveLength(0);
  });
});

describe("mergeUnique", () => {
  test("preserves order, drops duplicates, and caps", () => {
    const existing = [track("a", "A"), track("b", "B")];
    const incoming = [track("b", "B"), track("c", "C"), track("d", "D")];
    expect(mergeUnique(existing, incoming, 3).map((item) => item.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });
});
