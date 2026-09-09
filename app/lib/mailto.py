"""Building the emails an admin sends by hand, via `mailto:`.

Pure and dependency-free (no DB) so it can be unit-tested directly. The app
has no server-side mail capability anywhere -- every "email" opens the
admin's own mail client.
"""

from __future__ import annotations

from typing import List, Optional
from urllib.parse import quote

from app.lib.format import format_deadline


def join_names(names: List[str]) -> str:
    """"Amalie" / "Amalie and Mikkel" / "Amalie, Mikkel and Sofia"."""
    if len(names) == 0:
        return "your team"
    if len(names) == 1:
        return names[0]
    if len(names) == 2:
        return f"{names[0]} and {names[1]}"
    return f"{', '.join(names[:-1])} and {names[-1]}"


def subject_prefix(course_code: str, week_number: Optional[int], label: str) -> str:
    week = f"Week {week_number} · " if week_number is not None else ""
    return f"{course_code} · {week}{label}"


def team_link_email(
    course_code: str,
    assignment_title: str,
    week_number: Optional[int],
    due_at: int,
    team_name: str,
    team_short_code: str,
    member_names: List[str],
    link: str,
) -> tuple[str, str]:
    """The message that hands a team its link: what it's for, who's on it,
    when it's due, and a nudge to actually talk to each other."""
    subject = f"{subject_prefix(course_code, week_number, team_name)} — Your group link"

    greeting = join_names(member_names)
    body = "\n".join(
        [
            f"Hi {greeting},",
            "",
            f"Here is {team_name}'s page for {assignment_title}. It's where you "
            "deliver, and it has a discussion board so the three — or however "
            "many — of you can plan the work between you:",
            "",
            link,
            "",
            f"The deadline is {format_deadline(due_at)}. Talk it through to organize "
            "your work — there's a forum on that page too, if you don't know each "
            "other yet.",
            "",
            f"If the link ever stops working, your short code is {team_short_code}.",
        ]
    )
    return subject, body


def personal_link_email(course_code: str, student_name: str, link: str) -> tuple[str, str]:
    """The message that hands one student their permanent personal link --
    sent once, since the link doesn't change assignment to assignment."""
    subject = f"{course_code} — Your personal assignment page"
    body = "\n".join(
        [
            f"Hi {student_name},",
            "",
            "Here is your personal page for this course. Bookmark it — it's yours "
            "for the whole semester and lists the group link for every assignment "
            "you're placed in:",
            "",
            link,
            "",
            "Opening a group link from this page also means you won't be asked to "
            "pick your name from a list when you deliver or post there.",
        ]
    )
    return subject, body


def change_request_outcome_email(
    course_code: str, student_name: str, assignment_title: str, approved: bool, note: str
) -> tuple[str, str]:
    """The message an admin sends after acting on a group-change request."""
    subject = f"{course_code} — Your group change request for {assignment_title}"
    verdict = "approved and you've been moved to your new group" if approved else "declined"
    lines = [f"Hi {student_name},", "", f"Your request to change groups for {assignment_title} was {verdict}."]
    if note.strip():
        lines += ["", note.strip()]
    return subject, "\n".join(lines)


def feedback_email(
    course_code: str,
    assignment_title: str,
    week_number: Optional[int],
    team_name: str,
    comment: str,
) -> tuple[str, str]:
    """The message that carries a review comment to a team, rather than
    leaving it to be found only if they happen to reopen the page."""
    subject = f"{subject_prefix(course_code, week_number, team_name)} — Feedback on your delivery"
    body = "\n".join(
        [
            f"Hi {team_name},",
            "",
            f"Here's some feedback on your delivery for {assignment_title}:",
            "",
            comment,
        ]
    )
    return subject, body


def mailto_href(to: List[str], subject: str, body: str) -> str:
    return f"mailto:{','.join(to)}?subject={quote(subject)}&body={quote(body)}"
