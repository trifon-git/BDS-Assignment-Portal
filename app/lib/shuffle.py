"""Splitting a roster into groups of a chosen size, kept pure and
dependency-free so it can be unit-tested without a database -- the
database-facing half lives in `teams.py`.
"""

from __future__ import annotations

import secrets
from typing import List, Optional, Sequence, TypeVar

T = TypeVar("T")


def plan_group_sizes(n: int, preferred: int = 4) -> List[int]:
    """How many people go in each group, largest first.

    Starts from the fewest groups that keep every group at or under
    `preferred`, then spreads the remainder as evenly as possible. If that
    leaves a group smaller than the floor, one fewer group is used instead --
    a lone straggler is a worse working unit than a single oversized group,
    and it is a two-drag fix on the team board.

    The floor is `min(preferred, 3)`: asking for pairs (`preferred=2`) means
    pairs are the point, so a group of 2 is left alone; asking for anything
    3 or larger keeps the old rule of never leaving a group of 1 or 2 when a
    merge can avoid it. The only sizes this can ever produce below the floor
    are when the roster itself is too small to reach it (n < floor).
    """
    if n <= 0:
        return []
    if n <= preferred:
        return [n]

    floor = max(1, min(preferred, 3))

    groups = -(-n // preferred)  # ceil
    sizes = _spread(n, groups)

    while min(sizes) < floor and groups > 1:
        groups -= 1
        sizes = _spread(n, groups)

    return sizes


def _spread(n: int, groups: int) -> List[int]:
    """`n` split into `groups` parts as evenly as possible, largest first."""
    base = n // groups
    remainder = n % groups
    return [base + 1] * remainder + [base] * (groups - remainder)


def _imul32(x: int, y: int) -> int:
    """Bit-identical to JS `Math.imul` in the unsigned domain: 32-bit
    integer multiplication, overflow discarded."""
    return (x * y) & 0xFFFFFFFF


def _mulberry32(seed: int):
    """A small seedable PRNG (mulberry32), so a shuffle can be reproduced in
    a test. Not used for anything that needs to be unguessable -- that is
    what `generate_access_token` in ids.py is for.

    A faithful port of the JS original, kept in the unsigned 32-bit domain
    throughout so seeded output matches the TypeScript implementation
    bit-for-bit (`>>>` becomes plain `>>` once every intermediate value is
    masked to stay non-negative).
    """
    state = {"a": seed & 0xFFFFFFFF}

    def next_() -> float:
        state["a"] = (state["a"] + 0x6D2B79F5) & 0xFFFFFFFF
        a = state["a"]
        t = _imul32(a ^ (a >> 15), (1 | a) & 0xFFFFFFFF)
        t2 = _imul32(t ^ (t >> 7), (61 | t) & 0xFFFFFFFF)
        new_t = ((t + t2) & 0xFFFFFFFF) ^ t
        return ((new_t ^ (new_t >> 14)) & 0xFFFFFFFF) / 4294967296

    return next_


def _shuffle(items: Sequence[T], random) -> List[T]:
    result = list(items)
    for i in range(len(result) - 1, 0, -1):
        j = int(random() * (i + 1))
        result[i], result[j] = result[j], result[i]
    return result


def shuffle_into_groups(
    items: Sequence[T], preferred: int = 4, seed: Optional[int] = None
) -> List[List[T]]:
    """Randomly split `items` into groups of a chosen size (see
    `plan_group_sizes`).

    `seed` defaults to a CSPRNG-drawn 32-bit value, so an unseeded call is
    genuinely random each time; passing a `seed` makes the permutation
    reproducible, which is what the tests use.
    """
    if seed is None:
        seed = secrets.randbits(32)
    shuffled = _shuffle(items, _mulberry32(seed))
    sizes = plan_group_sizes(len(shuffled), preferred)

    groups: List[List[T]] = []
    offset = 0
    for size in sizes:
        groups.append(shuffled[offset : offset + size])
        offset += size
    return groups
