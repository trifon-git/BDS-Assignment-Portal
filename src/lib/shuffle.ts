import { randomBytes } from "node:crypto";

/**
 * Splitting a roster into groups of a chosen size, kept pure and
 * dependency-free so it can be unit-tested without a database — the
 * database-facing half lives in `teams.ts`.
 */

/**
 * How many people go in each group, largest first.
 *
 * Starts from the fewest groups that keep every group at or under `preferred`,
 * then spreads the remainder as evenly as possible. If that leaves a group
 * smaller than the floor, one fewer group is used instead — a lone straggler
 * is a worse working unit than a single oversized group, and it is a
 * two-drag fix on the team board.
 *
 * The floor is `min(preferred, 3)`: asking for pairs (`preferred: 2`) means
 * pairs are the point, so a group of 2 is left alone; asking for anything
 * 3 or larger keeps the old rule of never leaving a group of 1 or 2 when a
 * merge can avoid it. The only sizes this can ever produce below the floor
 * are when the roster itself is too small to reach it (n < floor).
 */
export function planGroupSizes(n: number, preferred: number = 4): number[] {
  if (n <= 0) return [];
  if (n <= preferred) return [n];

  const floor = Math.max(1, Math.min(preferred, 3));

  let groups = Math.ceil(n / preferred);
  let sizes = spread(n, groups);

  while (Math.min(...sizes) < floor && groups > 1) {
    groups--;
    sizes = spread(n, groups);
  }

  return sizes;
}

/** `n` split into `groups` parts as evenly as possible, largest first. */
function spread(n: number, groups: number): number[] {
  const base = Math.floor(n / groups);
  const remainder = n % groups;
  return [
    ...Array(remainder).fill(base + 1),
    ...Array(groups - remainder).fill(base),
  ];
}

/**
 * A small seedable PRNG (mulberry32), so a shuffle can be reproduced in a
 * test. Not used for anything that needs to be unguessable — that is what
 * `generateAccessToken` in ids.ts is for.
 */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: readonly T[], random: () => number): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/**
 * Randomly split `items` into groups of a chosen size (see `planGroupSizes`).
 *
 * `seed` defaults to a CSPRNG-drawn 32-bit value, so an unseeded call is
 * genuinely random each time; passing a `seed` makes the permutation
 * reproducible, which is what the tests use.
 */
export function shuffleIntoGroups<T>(
  items: readonly T[],
  opts?: { preferred?: number; seed?: number },
): T[][] {
  const seed = opts?.seed ?? randomBytes(4).readUInt32LE(0);
  const shuffled = shuffle(items, mulberry32(seed));
  const sizes = planGroupSizes(shuffled.length, opts?.preferred ?? 4);

  const groups: T[][] = [];
  let offset = 0;
  for (const size of sizes) {
    groups.push(shuffled.slice(offset, offset + size));
    offset += size;
  }
  return groups;
}
