"""Team forum reads.

Threading is flattened to one level (see forum_actions.py), so assembling a
tree is one query plus one pass: bucket every reply by its parent, then hand
each root its bucket. No N+1, no recursion.
"""

from __future__ import annotations

import sqlite3
from typing import Dict, List

from app.db import get_db


def get_team_forum(team_id: int) -> List[dict]:
    conn = get_db()
    rows = conn.execute(
        "SELECT * FROM forum_messages WHERE team_id = ? ORDER BY created_at",
        (team_id,),
    ).fetchall()

    by_parent: Dict[int, List[sqlite3.Row]] = {}
    for row in rows:
        if row["parent_id"] is not None:
            by_parent.setdefault(row["parent_id"], []).append(row)

    return [
        {"message": row, "replies": by_parent.get(row["id"], [])}
        for row in rows
        if row["parent_id"] is None
    ]


def get_forum_counts(team_ids: List[int]) -> Dict[int, int]:
    """Non-deleted message counts per team, for the admin teams list."""
    if not team_ids:
        return {}
    conn = get_db()
    placeholders = ",".join("?" for _ in team_ids)
    rows = conn.execute(
        f"SELECT team_id FROM forum_messages WHERE team_id IN ({placeholders}) "
        f"AND deleted_at IS NULL",
        team_ids,
    ).fetchall()
    counts: Dict[int, int] = {}
    for row in rows:
        counts[row["team_id"]] = counts.get(row["team_id"], 0) + 1
    return counts
