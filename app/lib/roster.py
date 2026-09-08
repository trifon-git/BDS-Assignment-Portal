"""Roster parsing.

The class list arrives as whatever the study administration exports -- a
CSV, a column pasted out of Excel, a block of addresses copied from an
email. This accepts all of those rather than demanding one exact format,
because the alternative is the teacher hand-editing a file before every
import.

Pure and dependency-free so it can be tested directly.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import List

_EMAIL = re.compile(r"[\w.+-]+@[\w.-]+\.\w{2,}")
_EMAIL_FULL = re.compile(rf"^{_EMAIL.pattern}$")


@dataclass(frozen=True)
class RosterEntry:
    name: str
    email: str


def is_emailish(value: str) -> bool:
    """Does this look like a single address? Used when one is typed by hand
    rather than pasted in a list. Deliberately the same rule as the bulk
    import, so a name that imports fine cannot be rejected when added
    individually.
    """
    return bool(_EMAIL_FULL.match(value.strip()))


def parse_roster(raw: str) -> List[RosterEntry]:
    # Keyed by email so the same address pasted twice collapses to one entry.
    out: dict[str, RosterEntry] = {}

    for line in re.split(r"\r?\n", raw):
        trimmed = line.strip()
        if not trimmed:
            continue

        match = _EMAIL.search(trimmed)
        if not match:
            continue

        email = match.group(0).lower()

        name = trimmed.replace(match.group(0), "")
        name = re.sub(r"[<>,;\"']", " ", name)
        name = re.sub(r"\s+", " ", name).strip()

        # A trailing CSV column such as a study number is not a name.
        if re.match(r"^\d+$", name):
            name = ""

        if not name:
            name = _name_from_email(email)

        out[email] = RosterEntry(name=name, email=email)

    return list(out.values())


def _name_from_email(email: str) -> str:
    """"amalie.soerensen" -> "Amalie Soerensen". A reasonable placeholder the
    teacher can correct, rather than leaving the row blank."""
    local = email.split("@")[0]
    parts = [p for p in re.split(r"[._-]+", local) if p]
    result = " ".join(p[0].upper() + p[1:] for p in parts)
    return result or email
