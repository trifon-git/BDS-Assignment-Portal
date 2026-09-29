"""The "Help me find a team" questionnaire and the matching it feeds.

Shown per assignment, only where an admin set team grouping to "Students form
their own" and only to a student who has no team for it yet. Answers are about
working style and availability, so the matching looks for *compatible* people:
similar ambition, weekly hours and rhythm, overlapping free time, a workable
meeting mode, teammates who cover different skills, and mutual "I'd like to be
with" picks honoured first. The output is a normal team like any other.

The earlier global, "fun" questionnaire (table `team_shuffle_responses`) is no
longer read or written; its table is deliberately left in place.
"""

from __future__ import annotations

import json
import secrets
import sqlite3
import time
from typing import Dict, List, Optional, Sequence, Set, Tuple

from app.db import db_lock, get_db
from app.lib.shuffle import _mulberry32, _shuffle, plan_group_sizes

HOURS = ["Up to 5", "5–10", "10–15", "15–20", "20 or more"]
MODES = [("campus", "On campus"), ("online", "Online"), ("either", "Either")]
SKILLS = [
    ("coding", "Coding"),
    ("analysis", "Analysis"),
    ("writing", "Writing"),
    ("presenting", "Presenting"),
    ("organising", "Organising"),
]
DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"]
SLOTS = ["Morning", "Afternoon", "Evening"]  # slot index = day * 3 + part of day

AMBITION_LABELS = ("Just pass it", "Aim for the top")
RHYTHM_LABELS = ("Start early, steady", "Sprint at the end")

MAX_SKILLS = 2
MAX_PREFERRED = 2
NOTE_MAX = 500

_MODE_KEYS = {k for k, _ in MODES}
_SKILL_KEYS = {k for k, _ in SKILLS}


# -------------------------------------------------------------------------
# Answers: validation and storage
# -------------------------------------------------------------------------


def parse_answers(form, allowed_preferred: Set[int]) -> Tuple[Optional[dict], Optional[str]]:
    """Turns a submitted form into a clean answers dict, or an error message.
    Nothing from the form is trusted: every value is range-checked, and the
    'be with' picks must be students who are still free for this assignment."""

    def scale(name: str) -> Optional[int]:
        try:
            v = int(form.get(name))
        except (TypeError, ValueError):
            return None
        return v if 1 <= v <= 5 else None

    def whole(name: str, upper: int) -> Optional[int]:
        try:
            v = int(form.get(name))
        except (TypeError, ValueError):
            return None
        return v if 0 <= v < upper else None

    ambition, rhythm, hours = scale("ambition"), scale("rhythm"), whole("hours", len(HOURS))
    if ambition is None or rhythm is None or hours is None:
        return None, "Please answer the ambition, hours and deadline questions."

    slots = set()
    for raw in form.getlist("slots"):
        try:
            v = int(raw)
        except (TypeError, ValueError):
            continue
        if 0 <= v < len(DAYS) * len(SLOTS):
            slots.add(v)
    if not slots:
        return None, "Tick at least one time that usually works for you."

    mode = form.get("mode")
    if mode not in _MODE_KEYS:
        return None, "Choose where you like to meet."

    skills = list(dict.fromkeys(s for s in form.getlist("skills") if s in _SKILL_KEYS))
    if not 1 <= len(skills) <= MAX_SKILLS:
        return None, f"Pick one or two things you bring (at most {MAX_SKILLS})."

    preferred: List[int] = []
    for raw in form.getlist("preferred"):
        try:
            v = int(raw)
        except (TypeError, ValueError):
            continue
        if v in allowed_preferred and v not in preferred:
            preferred.append(v)
    preferred = preferred[:MAX_PREFERRED]

    notes = " ".join(str(form.get("notes") or "").split())[:NOTE_MAX]

    return (
        {
            "ambition": ambition,
            "hours": hours,
            "rhythm": rhythm,
            "slots": sorted(slots),
            "mode": mode,
            "skills": skills,
            "preferred": preferred,
            "notes": notes,
        },
        None,
    )


def get_response(assignment_id: int, student_id: int) -> Optional[sqlite3.Row]:
    return get_db().execute(
        "SELECT * FROM team_matching_responses WHERE assignment_id = ? AND student_id = ?",
        (assignment_id, student_id),
    ).fetchone()


def get_answers(assignment_id: int, student_id: int) -> Optional[dict]:
    row = get_response(assignment_id, student_id)
    return json.loads(row["answers"]) if row else None


def save_response(assignment_id: int, student_id: int, answers: dict) -> None:
    with db_lock() as conn:
        conn.execute(
            "INSERT INTO team_matching_responses (assignment_id, student_id, answers, submitted_at) "
            "VALUES (?, ?, ?, ?) "
            "ON CONFLICT(assignment_id, student_id) DO UPDATE SET answers = excluded.answers, "
            "submitted_at = excluded.submitted_at",
            (assignment_id, student_id, json.dumps(answers), int(time.time() * 1000)),
        )
        conn.commit()


def get_responses_for(assignment_id: int, student_ids: Sequence[int]) -> Dict[int, dict]:
    """Answers for one assignment, keyed by student id. Students who haven't
    answered are simply absent."""
    if not student_ids:
        return {}
    marks = ",".join("?" for _ in student_ids)
    rows = get_db().execute(
        f"SELECT student_id, answers FROM team_matching_responses "
        f"WHERE assignment_id = ? AND student_id IN ({marks})",
        [assignment_id, *student_ids],
    ).fetchall()
    return {r["student_id"]: json.loads(r["answers"]) for r in rows}


def get_overview(assignment_id: int) -> dict:
    """Among students still without a team for this assignment: who has
    answered, and who hasn't. That is exactly the pool 'Form teams' uses."""
    from app.lib.team_access import get_unassigned_students

    free = get_unassigned_students(assignment_id)
    answered = set(get_responses_for(assignment_id, [s["id"] for s in free]))
    return {
        "responded": [s for s in free if s["id"] in answered],
        "missing": [s for s in free if s["id"] not in answered],
        "total_free": len(free),
    }


def describe(answers: dict) -> List[Tuple[str, str]]:
    """Human-readable (question, answer) rows, for the admin's per-student view."""
    days = {}
    for v in answers.get("slots", []):
        days.setdefault(v // len(SLOTS), []).append(SLOTS[v % len(SLOTS)])
    modes = dict(MODES)
    skills = dict(SKILLS)
    hours = answers.get("hours")
    return [
        ("Ambition (1 = " + AMBITION_LABELS[0].lower() + ", 5 = " + AMBITION_LABELS[1].lower() + ")",
         str(answers.get("ambition", "—"))),
        ("Hours a week", HOURS[hours] if isinstance(hours, int) and 0 <= hours < len(HOURS) else "—"),
        ("Deadline style (1 = " + RHYTHM_LABELS[0].lower() + ", 5 = " + RHYTHM_LABELS[1].lower() + ")",
         str(answers.get("rhythm", "—"))),
        ("Usually free", "; ".join(f"{DAYS[d]} {', '.join(p.lower() for p in parts)}" for d, parts in sorted(days.items())) or "—"),
        ("Meeting", modes.get(answers.get("mode"), "—")),
        ("Brings", ", ".join(skills.get(s, s) for s in answers.get("skills", [])) or "—"),
        ("Would like to be with", ""),  # filled in by the caller, which can resolve names
        ("Note for the lecturer", answers.get("notes") or "—"),
    ]


# -------------------------------------------------------------------------
# Compatibility
# -------------------------------------------------------------------------

# How much each thing counts toward two people being a good pair. Sums to 1.
_W_AMBITION, _W_HOURS, _W_RHYTHM, _W_SLOTS, _W_MODE = 0.28, 0.17, 0.17, 0.25, 0.13
# Three shared free slots a week is enough to meet; more adds nothing.
_ENOUGH_SHARED_SLOTS = 3
# Bonus when one/both people asked for each other. A mutual pick outweighs any
# gap in working style; a one-way pick is only a nudge.
_MUTUAL_BONUS, _ONE_WAY_BONUS = 1.5, 0.25
# Per-member value of a team covering as many different skills as possible.
_SKILL_BONUS = 0.15


def pair_compatibility(a: dict, b: dict) -> float:
    """0..1: how well two people's working styles and schedules fit."""
    ambition = 1 - abs(a["ambition"] - b["ambition"]) / 4
    hours = 1 - abs(a["hours"] - b["hours"]) / 4
    rhythm = 1 - abs(a["rhythm"] - b["rhythm"]) / 4
    shared = len(set(a["slots"]) & set(b["slots"]))
    slots = min(shared, _ENOUGH_SHARED_SLOTS) / _ENOUGH_SHARED_SLOTS
    mode = 0.0 if {a["mode"], b["mode"]} == {"campus", "online"} else 1.0
    return (
        _W_AMBITION * ambition + _W_HOURS * hours + _W_RHYTHM * rhythm
        + _W_SLOTS * slots + _W_MODE * mode
    )


def _skill_coverage(members: Sequence[dict]) -> float:
    distinct = {s for m in members for s in m["skills"]}
    return min(1.0, len(distinct) / min(len(SKILLS), max(3, len(members))))


def team_fit(members: Sequence[dict]) -> float:
    """0..1 for display: average pair compatibility inside one team."""
    pairs = [
        pair_compatibility(a, b) for i, a in enumerate(members) for b in members[i + 1:]
    ]
    return sum(pairs) / len(pairs) if pairs else 1.0


# -------------------------------------------------------------------------
# Forming teams
# -------------------------------------------------------------------------

# Randomised greedy passes, each polished by swaps; the best result is kept.
# Course-sized rosters make each pass a few milliseconds.
RESTART_COUNT = 30


def _pair_values(students: Sequence[Tuple[int, dict]]) -> List[List[float]]:
    """Symmetric matrix of pair value: compatibility plus any request bonus."""
    n = len(students)
    index = {sid: i for i, (sid, _) in enumerate(students)}
    wants = [
        {index[p] for p in ans["preferred"] if p in index and p != sid}
        for sid, ans in students
    ]
    vals = [[0.0] * n for _ in range(n)]
    for i in range(n):
        for j in range(i + 1, n):
            v = pair_compatibility(students[i][1], students[j][1])
            i_wants_j, j_wants_i = j in wants[i], i in wants[j]
            if i_wants_j and j_wants_i:
                v += _MUTUAL_BONUS
            elif i_wants_j or j_wants_i:
                v += _ONE_WAY_BONUS
            vals[i][j] = vals[j][i] = v
    return vals


def _team_value(team: Sequence[int], vals: List[List[float]], answers: Sequence[dict]) -> float:
    pair_sum = sum(vals[a][b] for i, a in enumerate(team) for b in team[i + 1:])
    return pair_sum + _SKILL_BONUS * len(team) * _skill_coverage([answers[i] for i in team])


def _one_pass(vals, answers, sizes: List[int], seed: int) -> List[List[int]]:
    n = len(answers)
    teams: List[List[int]] = [[] for _ in sizes]
    for i in _shuffle(list(range(n)), _mulberry32(seed)):
        best, best_gain = -1, float("-inf")
        for ti, team in enumerate(teams):
            if len(team) >= sizes[ti]:
                continue
            gain = sum(vals[i][m] for m in team)
            if not team:
                gain = -0.001 * ti  # an empty team has no signal: prefer the earliest
            if gain > best_gain:
                best, best_gain = ti, gain
        teams[best].append(i)

    # Polish: swap two people across teams whenever that raises the total.
    improved = True
    for _ in range(20):
        if not improved:
            break
        improved = False
        for ta in range(len(teams)):
            for tb in range(ta + 1, len(teams)):
                for ia in range(len(teams[ta])):
                    for ib in range(len(teams[tb])):
                        a, b = teams[ta][ia], teams[tb][ib]
                        before = _team_value(teams[ta], vals, answers) + _team_value(teams[tb], vals, answers)
                        teams[ta][ia], teams[tb][ib] = b, a
                        after = _team_value(teams[ta], vals, answers) + _team_value(teams[tb], vals, answers)
                        if after > before + 1e-9:
                            improved = True
                        else:
                            teams[ta][ia], teams[tb][ib] = a, b
    return teams


def form_compatible_teams(
    students: Sequence[Tuple[int, dict]],
    preferred: int = 4,
    seed: Optional[int] = None,
) -> List[List[int]]:
    """`students` is (student_id, answers) pairs; returns groups of ids.
    Group sizes come from `plan_group_sizes`, the same rule the random shuffle
    uses, so only *who* goes where differs. An explicit `seed` makes a single
    deterministic pass (for tests); otherwise the best of several is kept."""
    if not students:
        return []
    answers = [a for _, a in students]
    vals = _pair_values(students)
    sizes = plan_group_sizes(len(students), preferred)

    def total(teams):
        return sum(_team_value(t, vals, answers) for t in teams)

    if seed is not None:
        best = _one_pass(vals, answers, sizes, seed)
    else:
        best, best_score = None, float("-inf")
        for _ in range(RESTART_COUNT):
            teams = _one_pass(vals, answers, sizes, secrets.randbits(32))
            score = total(teams)
            if score > best_score:
                best, best_score = teams, score
    return [[students[i][0] for i in team] for team in best if team]
