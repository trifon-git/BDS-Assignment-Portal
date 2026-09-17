"""Questionnaire-based team splitting.

A second, opt-in way to form teams alongside the random shuffle in
`teams.py` / `shuffle.py`. Students answer a short, non-identifying
preference quiz once (reused across every assignment, not re-asked per
week); an admin then asks this module to cluster respondents into teams
that are internally *diverse* on those answers, while steering away from
pairing up two students who already shared a team before.

Ported from https://github.com/trifon-git/Shuffling-app (a client-only
prototype that kept everything in browser localStorage) onto this app's
existing students/teams/team_members tables, so the output is a normal
team like any other -- nothing downstream needs to know how it was formed.
"""

from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass
from typing import Dict, List, Optional, Sequence, Set, Tuple

from app.db import db_lock, get_db
from app.lib.shuffle import _mulberry32, _shuffle, plan_group_sizes

# 10 fast, fun multiple-choice questions. No personal / sensitive data --
# just light preferences used purely to spread people across teams. Keep
# `key` stable: it's the field name saved in each response's `answers` JSON.
QUESTIONS = [
    {
        "key": "pizza",
        "label": "🍕 If you were a pizza topping, you'd be:",
        "options": ["🍕 Pepperoni (bold)", "🍄 Mushroom (chill)", "🍍 Pineapple (controversial)", "🧀 Extra cheese (comfort-lover)"],
    },
    {
        "key": "superpower",
        "label": "🦸 Pick your superpower:",
        "options": ["🧠 Mind reading", "🕊️ Flying", "🫥 Invisibility", "💪 Super strength"],
    },
    {
        "key": "movie",
        "label": "🎬 Movie night pick:",
        "options": ["😂 Comedy", "👻 Horror", "💥 Action", "🎥 Documentary"],
    },
    {
        "key": "morning",
        "label": "🌅 Your energy first thing in the morning:",
        "options": ["⚡ Wide awake and ready", "☕ Need coffee first", "🧟 Barely alive", "🎲 Depends on the day"],
    },
    {
        "key": "desert_island",
        "label": "🏝️ Stranded on a desert island, you bring:",
        "options": ["📱 A fully charged phone", "📖 A good book", "🍫 Endless snacks", "🧑‍🤝‍🧑 A friend"],
    },
    {
        "key": "karaoke",
        "label": "🎤 Your karaoke go-to:",
        "options": ["💘 Power ballad", "🎉 Pop banger", "🤘 Rock anthem", "🙅 I don't sing, ever"],
    },
    {
        "key": "snack",
        "label": "🍿 Favorite snack while working:",
        "options": ["🍟 Chips", "🍫 Chocolate", "🍎 Fruit", "☕ Just coffee or tea"],
    },
    {
        "key": "spirit_animal",
        "label": "🐾 Your spirit animal is:",
        "options": ["🦉 Owl", "🐬 Dolphin", "🐱 Cat", "🐶 Golden retriever"],
    },
    {
        "key": "weekend",
        "label": "🗓️ Ideal weekend vibe:",
        "options": ["🛋️ Netflix and chill", "🏔️ Outdoor adventure", "🎉 Hanging with friends", "😴 Catching up on sleep"],
    },
    {
        "key": "soundtrack",
        "label": "🎧 The soundtrack to your life right now:",
        "options": ["🎵 Upbeat pop", "🌙 Chill lo-fi", "🎻 Epic orchestral", "🔀 Random shuffle"],
    },
]

# Added to a team's similarity score for every member the candidate has
# already shared a team with before -- large enough that the algorithm
# always prefers a team with zero repeat partners when one exists, but not
# a hard rule, so a roster too small to avoid every repeat still finishes
# instead of erroring out.
REPEAT_PARTNER_PENALTY = 1000


# -------------------------------------------------------------------------
# Responses
# -------------------------------------------------------------------------


def get_response(student_id: int) -> Optional[sqlite3.Row]:
    conn = get_db()
    return conn.execute(
        "SELECT * FROM team_shuffle_responses WHERE student_id = ?", (student_id,)
    ).fetchone()


def get_answers(student_id: int) -> Optional[dict]:
    row = get_response(student_id)
    return json.loads(row["answers"]) if row else None


def save_response(student_id: int, answers: Dict[str, int]) -> None:
    import time

    with db_lock() as conn:
        conn.execute(
            "INSERT INTO team_shuffle_responses (student_id, answers, submitted_at) "
            "VALUES (?, ?, ?) "
            "ON CONFLICT(student_id) DO UPDATE SET answers = excluded.answers, "
            "submitted_at = excluded.submitted_at",
            (student_id, json.dumps(answers), int(time.time() * 1000)),
        )
        conn.commit()


def get_response_count() -> int:
    conn = get_db()
    return conn.execute("SELECT count(*) AS n FROM team_shuffle_responses").fetchone()["n"]


def get_responses_for(student_ids: Sequence[int]) -> Dict[int, dict]:
    """Answers for a set of students, keyed by student id. Students with no
    saved response are simply absent from the result -- callers decide
    whether that means "leave them out" or "place them anyway"."""
    if not student_ids:
        return {}
    conn = get_db()
    placeholders = ",".join("?" for _ in student_ids)
    rows = conn.execute(
        f"SELECT student_id, answers FROM team_shuffle_responses "
        f"WHERE student_id IN ({placeholders})",
        list(student_ids),
    ).fetchall()
    return {r["student_id"]: json.loads(r["answers"]) for r in rows}


# -------------------------------------------------------------------------
# Pairing history -- who has already been teamed with whom, ever.
# -------------------------------------------------------------------------


def get_pair_history() -> Dict[int, Set[int]]:
    """Every "these two students were on the same team" fact across every
    assignment this course has ever run, so a new questionnaire split can
    steer away from repeating them."""
    conn = get_db()
    rows = conn.execute(
        "SELECT team_id, student_id FROM team_members ORDER BY team_id"
    ).fetchall()

    by_team: Dict[int, List[int]] = {}
    for r in rows:
        by_team.setdefault(r["team_id"], []).append(r["student_id"])

    history: Dict[int, Set[int]] = {}
    for members in by_team.values():
        for a in members:
            for b in members:
                if a == b:
                    continue
                history.setdefault(a, set()).add(b)
    return history


# -------------------------------------------------------------------------
# Clustering -- one-hot encode answers, greedily assign each student to
# whichever not-yet-full team currently looks LEAST similar to them, so
# similar answers spread across different teams instead of clumping.
# -------------------------------------------------------------------------


def _encode(answers_list: Sequence[dict]) -> List[List[int]]:
    offsets = []
    total = 0
    for q in QUESTIONS:
        offsets.append(total)
        total += len(q["options"])

    vectors = []
    for answers in answers_list:
        vec = [0] * total
        for qi, q in enumerate(QUESTIONS):
            val = answers.get(q["key"])
            if isinstance(val, int) and 0 <= val < len(q["options"]):
                vec[offsets[qi] + val] = 1
        vectors.append(vec)
    return vectors


def _dot(a: List[int], b: List[int]) -> int:
    return sum(x * y for x, y in zip(a, b))


def _add_in_place(a: List[int], b: List[int]) -> None:
    for i in range(len(a)):
        a[i] += b[i]


def form_diverse_teams(
    students: Sequence[Tuple[int, dict]],
    preferred: int = 4,
    pair_history: Optional[Dict[int, Set[int]]] = None,
    seed: Optional[int] = None,
) -> List[List[int]]:
    """`students` is a list of (student_id, answers) pairs. Returns a list
    of groups of student ids.

    Team sizing reuses `plan_group_sizes` from the random shuffle so both
    methods land on the same group-size rules (largest-first, no lone
    stragglers) -- only *who* goes where differs.
    """
    if not students:
        return []

    pair_history = pair_history or {}
    answers_list = [a for _, a in students]
    vectors = _encode(answers_list)
    vec_len = len(vectors[0])

    order = list(range(len(students)))
    if seed is None:
        import secrets

        seed = secrets.randbits(32)
    order = _shuffle(order, _mulberry32(seed))

    sizes = plan_group_sizes(len(students), preferred)
    teams: List[dict] = [{"members": [], "vec_sum": [0] * vec_len} for _ in sizes]

    for idx in order:
        student_id, _ = students[idx]
        vec = vectors[idx]
        best = -1
        best_score = float("inf")
        for ti, team in enumerate(teams):
            if len(team["members"]) >= sizes[ti]:
                continue
            size = len(team["members"])
            similarity = 0.0 if size == 0 else _dot(team["vec_sum"], vec) / size
            repeats = sum(1 for m in team["members"] if m in pair_history.get(student_id, ()))
            similarity += repeats * REPEAT_PARTNER_PENALTY
            if similarity < best_score:
                best_score = similarity
                best = ti
        teams[best]["members"].append(student_id)
        _add_in_place(teams[best]["vec_sum"], vec)

    return [t["members"] for t in teams if t["members"]]


# -------------------------------------------------------------------------
# Diversity analysis -- shown to the admin after forming teams, mirrors the
# original app's "why these teams" breakdown.
# -------------------------------------------------------------------------


def question_significance(answers_list: Sequence[dict]) -> List[dict]:
    """Gini-Simpson diversity index per question: 1 - sum(p_i^2). 0 means
    everyone answered the same; it approaches 1 as answers spread evenly
    across more options. Ranks which questions actually carried signal for
    telling students apart."""
    n = len(answers_list)
    results = []
    for q in QUESTIONS:
        counts = [0] * len(q["options"])
        for answers in answers_list:
            v = answers.get(q["key"])
            if isinstance(v, int) and 0 <= v < len(counts):
                counts[v] += 1
        sum_sq = sum((c / n) ** 2 for c in counts) if n else 0
        gini_simpson = 1 - sum_sq
        max_possible = 1 - 1 / len(q["options"])
        relative = gini_simpson / max_possible if max_possible > 0 else 0
        results.append(
            {
                "key": q["key"],
                "label": q["label"],
                "options": q["options"],
                "counts": counts,
                "relative": relative,
                "pct": round(relative * 100),
            }
        )
    results.sort(key=lambda r: r["relative"], reverse=True)
    return results


def team_diversity_score(team_answers: Sequence[dict]) -> float:
    """Share of the group's overall answer variety represented inside one
    team, averaged across all questions."""
    if not team_answers:
        return 0.0
    per_question = []
    for q in QUESTIONS:
        seen = set()
        for answers in team_answers:
            v = answers.get(q["key"])
            if isinstance(v, int):
                seen.add(v)
        max_unique = min(len(team_answers), len(q["options"]))
        per_question.append(len(seen) / max_unique if max_unique > 0 else 0)
    return sum(per_question) / len(per_question)
