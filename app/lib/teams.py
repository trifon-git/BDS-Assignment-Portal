"""Team operations that are worth testing on their own."""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Optional

from app.db import db_lock, get_db
from app.lib.ids import generate_access_token, generate_short_code
from app.lib.shuffle import shuffle_into_groups


@dataclass
class ShuffleResult:
    created: int
    placed: int
    deleted: int
    protected_teams: int
    skipped: int = 0


def copy_teams(from_assignment_id: int, to_assignment_id: int) -> int:
    """Clone one assignment's teams onto another. Returns how many were
    created.

    Fresh links and codes are minted on purpose -- the copy is a new set of
    teams, and a code that unlocked last week's delivery must not unlock
    this week's.

    A student already grouped for the target assignment is skipped rather
    than moved, so running this twice, or after some students have
    organised themselves, never undoes what is already there. A source team
    whose members are all already placed produces no empty team.
    """
    if from_assignment_id == to_assignment_id:
        return 0

    with db_lock() as conn:
        source_teams = conn.execute(
            "SELECT * FROM teams WHERE assignment_id = ?", (from_assignment_id,)
        ).fetchall()

        already_grouped = {
            row["student_id"]
            for row in conn.execute(
                "SELECT student_id FROM team_members WHERE assignment_id = ?",
                (to_assignment_id,),
            ).fetchall()
        }

        created = 0
        for team in source_teams:
            members = [
                row["student_id"]
                for row in conn.execute(
                    "SELECT student_id FROM team_members WHERE team_id = ?",
                    (team["id"],),
                ).fetchall()
                if row["student_id"] not in already_grouped
            ]
            if not members:
                continue

            cur = conn.execute(
                "INSERT INTO teams (assignment_id, name, access_token, short_code) "
                "VALUES (?, ?, ?, ?)",
                (to_assignment_id, team["name"], generate_access_token(), generate_short_code()),
            )
            new_team_id = cur.lastrowid

            conn.executemany(
                "INSERT INTO team_members (team_id, assignment_id, student_id) "
                "VALUES (?, ?, ?)",
                [(new_team_id, to_assignment_id, sid) for sid in members],
            )

            already_grouped.update(members)
            created += 1

        conn.commit()
        return created


def count_protected_teams(assignment_id: int) -> int:
    """How many of this assignment's teams a "re-shuffle everyone" would
    refuse to touch, because they already have a submission or a deadline
    extension. Used to name the real number in the confirm dialog rather
    than a hypothetical.
    """
    conn = get_db()
    ids = set()
    for row in conn.execute(
        "SELECT DISTINCT team_id FROM submissions WHERE assignment_id = ?",
        (assignment_id,),
    ).fetchall():
        ids.add(row["team_id"])
    for row in conn.execute(
        "SELECT DISTINCT team_id FROM deadline_extensions WHERE assignment_id = ?",
        (assignment_id,),
    ).fetchall():
        ids.add(row["team_id"])
    return len(ids)


def shuffle_teams(
    assignment_id: int,
    mode: str = "fill",
    preferred: int = 4,
    seed: Optional[int] = None,
) -> ShuffleResult:
    """Auto-group a roster into teams of a chosen size for one assignment.

    `mode="fill"` (the default) only touches students who have no team for
    this assignment yet, so running it after some students have organised
    themselves -- or running it twice -- never undoes what is already
    there.

    `mode="reshuffle"` re-cuts everyone, deleting the assignment's existing
    teams first -- except any team that already has a submission or a
    deadline extension attached. Both of those cascade off `teams.id`, so
    deleting such a team would silently take real deliveries and their
    files with it; this function refuses to do that regardless of what the
    caller asked for, since it may be reached directly rather than only
    through the confirm dialog that names the risk.
    """
    with db_lock() as conn:
        existing_teams = conn.execute(
            "SELECT * FROM teams WHERE assignment_id = ?", (assignment_id,)
        ).fetchall()

        protected_ids = set()
        for row in conn.execute(
            "SELECT DISTINCT team_id FROM submissions WHERE assignment_id = ?",
            (assignment_id,),
        ).fetchall():
            protected_ids.add(row["team_id"])
        for row in conn.execute(
            "SELECT DISTINCT team_id FROM deadline_extensions WHERE assignment_id = ?",
            (assignment_id,),
        ).fetchall():
            protected_ids.add(row["team_id"])

        protected_teams = [t for t in existing_teams if t["id"] in protected_ids]

        deleted = 0
        if mode == "reshuffle":
            removable = [t for t in existing_teams if t["id"] not in protected_ids]
            for t in removable:
                conn.execute("DELETE FROM teams WHERE id = ?", (t["id"],))
            deleted = len(removable)

            protected_student_ids = set()
            if protected_teams:
                placeholders = ",".join("?" for _ in protected_teams)
                rows = conn.execute(
                    f"SELECT student_id FROM team_members WHERE assignment_id = ? "
                    f"AND team_id IN ({placeholders})",
                    (assignment_id, *[t["id"] for t in protected_teams]),
                ).fetchall()
                protected_student_ids = {r["student_id"] for r in rows}

            pool = [
                r["id"]
                for r in conn.execute(
                    "SELECT id FROM students WHERE active = 1"
                ).fetchall()
                if r["id"] not in protected_student_ids
            ]
        else:
            already_grouped = {
                r["student_id"]
                for r in conn.execute(
                    "SELECT student_id FROM team_members WHERE assignment_id = ?",
                    (assignment_id,),
                ).fetchall()
            }
            pool = [
                r["id"]
                for r in conn.execute(
                    "SELECT id FROM students WHERE active = 1"
                ).fetchall()
                if r["id"] not in already_grouped
            ]

        groups = shuffle_into_groups(pool, preferred=preferred, seed=seed)

        next_number = 1
        for t in existing_teams:
            m = re.match(r"^Group (\d+)$", t["name"])
            if m:
                next_number = max(next_number, int(m.group(1)) + 1)

        created = 0
        placed = 0
        for group in groups:
            cur = conn.execute(
                "INSERT INTO teams (assignment_id, name, access_token, short_code) "
                "VALUES (?, ?, ?, ?)",
                (
                    assignment_id,
                    f"Group {next_number}",
                    generate_access_token(),
                    generate_short_code(),
                ),
            )
            next_number += 1
            team_id = cur.lastrowid

            conn.executemany(
                "INSERT INTO team_members (team_id, assignment_id, student_id) "
                "VALUES (?, ?, ?)",
                [(team_id, assignment_id, sid) for sid in group],
            )

            created += 1
            placed += len(group)

        conn.commit()

        return ShuffleResult(
            created=created,
            placed=placed,
            deleted=deleted,
            protected_teams=len(protected_teams),
        )
