import type { Assignment } from "@/db/schema";

/**
 * Deadline resolution, kept pure and dependency-free so it can be unit-tested
 * without a database. Every "is this late / can they still submit / what does
 * the badge say" decision in the app routes through here, so there is exactly
 * one definition of each.
 */

export type DeliveryState =
  /** Nothing delivered and the deadline has not passed. */
  | "pending"
  /** Nothing delivered, deadline passed. */
  | "missing"
  /** Delivered on time. */
  | "delivered"
  /** Delivered, but after the deadline. */
  | "late"
  /** Delivered and the reviewer approved it. */
  | "approved"
  /** Delivered and the reviewer asked for changes. */
  | "rework";

export interface DeadlineInfo {
  /** The deadline that actually applies, after any per-team extension. */
  effectiveDueAt: number;
  /** True when an extension moved the date. */
  extended: boolean;
  /** Deadline is in the past. */
  overdue: boolean;
  /** A student can still open the form and submit. */
  canSubmit: boolean;
  /** A submission made right now would be flagged late. */
  wouldBeLate: boolean;
  msRemaining: number;
}

/**
 * Resolve the deadline for one team on one assignment.
 *
 * `extensionDueAt` wins over the assignment's own date whenever it is present —
 * including when it is *earlier*, so an admin can also pull a deadline in for a
 * specific team rather than only pushing it out.
 */
export function resolveDeadline(
  assignment: Pick<Assignment, "dueAt" | "acceptLate">,
  extensionDueAt: number | null | undefined,
  now: number = Date.now(),
): DeadlineInfo {
  const effectiveDueAt = extensionDueAt ?? assignment.dueAt;
  const overdue = now > effectiveDueAt;

  return {
    effectiveDueAt,
    extended: extensionDueAt != null && extensionDueAt !== assignment.dueAt,
    overdue,
    // Once the deadline passes, the form stays open only if late deliveries are
    // accepted for this assignment.
    canSubmit: !overdue || assignment.acceptLate,
    wouldBeLate: overdue,
    msRemaining: effectiveDueAt - now,
  };
}

/**
 * The single status a row in the delivery matrix (or a card on the student
 * dashboard) should show.
 *
 * Review outcome outranks timing: once a reviewer has approved something, that
 * is the useful fact, and lateness is still available separately via `isLate`
 * for the admin's "who was late" filter.
 */
export function deliveryState(
  submission:
    | { status: "submitted" | "approved" | "rework"; isLate: boolean }
    | null
    | undefined,
  deadline: Pick<DeadlineInfo, "overdue">,
): DeliveryState {
  if (!submission) return deadline.overdue ? "missing" : "pending";
  if (submission.status === "approved") return "approved";
  if (submission.status === "rework") return "rework";
  return submission.isLate ? "late" : "delivered";
}

export const STATE_LABEL: Record<DeliveryState, string> = {
  pending: "Not delivered yet",
  missing: "Missing",
  delivered: "Delivered",
  late: "Delivered late",
  approved: "Approved",
  rework: "Needs rework",
};

/**
 * Whether a state should be chased. Drives the admin panel's "missing only"
 * filter and the outstanding counts on the dashboard.
 */
export function isOutstanding(state: DeliveryState): boolean {
  return state === "missing" || state === "pending" || state === "rework";
}

/**
 * Human countdown for the student dashboard: "in 3 days", "in 5 hours",
 * "2 days ago". Deliberately coarse — students need urgency, not precision.
 */
export function formatRelative(ms: number): string {
  const abs = Math.abs(ms);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  let value: number;
  let unit: string;

  if (abs < hour) {
    value = Math.max(1, Math.round(abs / minute));
    unit = "minute";
  } else if (abs < day) {
    value = Math.round(abs / hour);
    unit = "hour";
  } else {
    value = Math.round(abs / day);
    unit = "day";
  }

  const plural = value === 1 ? unit : `${unit}s`;
  return ms >= 0 ? `in ${value} ${plural}` : `${value} ${plural} ago`;
}
