import { describe, expect, it } from "vitest";

import { planGroupSizes, shuffleIntoGroups } from "./shuffle";

describe("planGroupSizes", () => {
  it("returns nothing for an empty roster", () => {
    expect(planGroupSizes(0)).toEqual([]);
  });

  it("never splits a roster that already fits in one group", () => {
    expect(planGroupSizes(1)).toEqual([1]);
    expect(planGroupSizes(2)).toEqual([2]);
    expect(planGroupSizes(3)).toEqual([3]);
    expect(planGroupSizes(4)).toEqual([4]);
  });

  it("collapses the awkward five into one group rather than a pair", () => {
    expect(planGroupSizes(5)).toEqual([5]);
  });

  it("keeps every group at 3 or 4 whenever the roster allows it", () => {
    for (let n = 6; n <= 40; n++) {
      const sizes = planGroupSizes(n);
      expect(sizes.reduce((a, b) => a + b, 0)).toBe(n);
      for (const size of sizes) {
        expect(size).toBeGreaterThanOrEqual(3);
        expect(size).toBeLessThanOrEqual(4);
      }
    }
  });

  it("respects a preference for groups of 3", () => {
    expect(planGroupSizes(9, 3)).toEqual([3, 3, 3]);
    expect(planGroupSizes(12, 3)).toEqual([3, 3, 3, 3]);
  });

  it("never produces a group of 1 or 2 once there are enough people to avoid it", () => {
    for (let n = 6; n <= 60; n++) {
      for (const preferred of [3, 4] as const) {
        const sizes = planGroupSizes(n, preferred);
        expect(Math.min(...sizes)).toBeGreaterThanOrEqual(3);
      }
    }
  });
});

describe("shuffleIntoGroups", () => {
  const roster = Array.from({ length: 23 }, (_, i) => i + 1);

  it("loses nobody and duplicates nobody", () => {
    const groups = shuffleIntoGroups(roster, { seed: 1 });
    const flat = groups.flat().sort((a, b) => a - b);
    expect(flat).toEqual(roster);
  });

  it("keeps every group within the size policy", () => {
    const groups = shuffleIntoGroups(roster, { seed: 1 });
    for (const g of groups) {
      expect(g.length).toBeGreaterThanOrEqual(3);
      expect(g.length).toBeLessThanOrEqual(4);
    }
  });

  it("is reproducible for a given seed", () => {
    const a = shuffleIntoGroups(roster, { seed: 42 });
    const b = shuffleIntoGroups(roster, { seed: 42 });
    expect(a).toEqual(b);
  });

  it("produces a different permutation for a different seed", () => {
    const a = shuffleIntoGroups(roster, { seed: 1 });
    const b = shuffleIntoGroups(roster, { seed: 2 });
    expect(a).not.toEqual(b);
  });

  it("handles a roster too small to split", () => {
    const groups = shuffleIntoGroups([1, 2], { seed: 1 });
    expect(groups).toHaveLength(1);
    expect(groups[0].sort()).toEqual([1, 2]);
  });

  it("handles an empty roster", () => {
    expect(shuffleIntoGroups([], { seed: 1 })).toEqual([]);
  });
});
