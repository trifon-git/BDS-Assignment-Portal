import { formatDeadline } from "./format";

/**
 * Building the emails an admin sends by hand, via `mailto:`.
 *
 * Pure and dependency-free (no DB, no React) so it can be imported from client
 * components and unit-tested directly. The app has no server-side mail
 * capability anywhere — every "email" opens the admin's own mail client.
 */

/** "Amalie" / "Amalie and Mikkel" / "Amalie, Mikkel and Sofia". */
export function joinNames(names: string[]): string {
  if (names.length === 0) return "your team";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

function subjectPrefix(
  courseCode: string,
  weekNumber: number | null,
  label: string,
): string {
  const week = weekNumber != null ? `Week ${weekNumber} · ` : "";
  return `${courseCode} · ${week}${label}`;
}

export interface TeamLinkEmailInput {
  courseCode: string;
  assignment: { title: string; weekNumber: number | null; dueAt: number };
  team: { name: string; shortCode: string };
  members: { name: string }[];
  link: string;
}

/** The message that hands a team its link: what it's for, who's on it, when
 *  it's due, and a nudge to actually talk to each other. */
export function teamLinkEmail(
  input: TeamLinkEmailInput,
): { subject: string; body: string } {
  const { courseCode, assignment, team, members, link } = input;
  const subject = `${subjectPrefix(courseCode, assignment.weekNumber, team.name)} — Your group link`;

  const greeting = joinNames(members.map((m) => m.name));
  const body = [
    `Hi ${greeting},`,
    "",
    `Here is ${team.name}'s page for ${assignment.title}. It's where you deliver, and it has a discussion board so the three — or however many — of you can plan the work between you:`,
    "",
    link,
    "",
    `The deadline is ${formatDeadline(assignment.dueAt)}. Talk it through on the forum on that page before you get started.`,
    "",
    `If the link ever stops working, your short code is ${team.shortCode}.`,
  ].join("\n");

  return { subject, body };
}

export interface FeedbackEmailInput {
  courseCode: string;
  assignment: { title: string; weekNumber: number | null };
  team: { name: string };
  comment: string;
}

/** The message that carries a review comment to a team, rather than leaving
 *  it to be found only if they happen to reopen the page. */
export function feedbackEmail(
  input: FeedbackEmailInput,
): { subject: string; body: string } {
  const { courseCode, assignment, team, comment } = input;
  const subject = `${subjectPrefix(courseCode, assignment.weekNumber, team.name)} — Feedback on your delivery`;

  const body = [
    `Hi ${team.name},`,
    "",
    `Here's some feedback on your delivery for ${assignment.title}:`,
    "",
    comment,
  ].join("\n");

  return { subject, body };
}

export function mailtoHref(to: string[], subject: string, body: string): string {
  return `mailto:${to.join(",")}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
