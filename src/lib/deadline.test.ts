import { describe, expect, it } from "vitest";

import {
  deliveryState,
  formatRelative,
  isOutstanding,
  resolveDeadline,
} from "./deadline";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Friday 2026-09-04 23:59 local, the shape of a real weekly deadline. */
const DUE = new Date("2026-09-04T23:59:00Z").getTime();

const lateAccepted = { dueAt: DUE, acceptLate: true };
const lateRejected = { dueAt: DUE, acceptLate: false };

describe("resolveDeadline", () => {
  it("is open and not late before the deadline", () => {
    const d = resolveDeadline(lateAccepted, null, DUE - 2 * DAY);
    expect(d.overdue).toBe(false);
    expect(d.canSubmit).toBe(true);
    expect(d.wouldBeLate).toBe(false);
    expect(d.effectiveDueAt).toBe(DUE);
    expect(d.extended).toBe(false);
  });

  it("stays open but flags late when late delivery is accepted", () => {
    const d = resolveDeadline(lateAccepted, null, DUE + HOUR);
    expect(d.overdue).toBe(true);
    expect(d.canSubmit).toBe(true);
    expect(d.wouldBeLate).toBe(true);
  });

  it("closes the form when late delivery is not accepted", () => {
    const d = resolveDeadline(lateRejected, null, DUE + HOUR);
    expect(d.overdue).toBe(true);
    expect(d.canSubmit).toBe(false);
  });

  it("treats the exact deadline instant as still on time", () => {
    const d = resolveDeadline(lateRejected, null, DUE);
    expect(d.overdue).toBe(false);
    expect(d.canSubmit).toBe(true);
  });

  it("lets an extension reopen a closed assignment", () => {
    const extended = DUE + 3 * DAY;
    const d = resolveDeadline(lateRejected, extended, DUE + DAY);
    expect(d.effectiveDueAt).toBe(extended);
    expect(d.extended).toBe(true);
    expect(d.overdue).toBe(false);
    expect(d.canSubmit).toBe(true);
    expect(d.wouldBeLate).toBe(false);
  });

  it("lets an extension also pull a deadline earlier", () => {
    const earlier = DUE - 2 * DAY;
    const d = resolveDeadline(lateRejected, earlier, DUE - DAY);
    expect(d.effectiveDueAt).toBe(earlier);
    expect(d.overdue).toBe(true);
    expect(d.canSubmit).toBe(false);
  });

  it("does not report an extension that matches the original date", () => {
    expect(resolveDeadline(lateAccepted, DUE, DUE - DAY).extended).toBe(false);
  });
});

describe("deliveryState", () => {
  const open = { overdue: false };
  const past = { overdue: true };

  it("separates 'not yet' from 'missing' by the deadline", () => {
    expect(deliveryState(null, open)).toBe("pending");
    expect(deliveryState(null, past)).toBe("missing");
  });

  it("reports delivered vs late from the frozen flag", () => {
    expect(deliveryState({ status: "submitted", isLate: false }, past)).toBe(
      "delivered",
    );
    expect(deliveryState({ status: "submitted", isLate: true }, past)).toBe(
      "late",
    );
  });

  it("lets a review outcome outrank timing", () => {
    expect(deliveryState({ status: "approved", isLate: true }, past)).toBe(
      "approved",
    );
    expect(deliveryState({ status: "rework", isLate: false }, past)).toBe(
      "rework",
    );
  });
});

describe("isOutstanding", () => {
  it("counts anything the teacher still needs to chase", () => {
    expect(["missing", "pending", "rework"].every(isOutstanding as never)).toBe(
      true,
    );
    expect(["delivered", "late", "approved"].some(isOutstanding as never)).toBe(
      false,
    );
  });
});

describe("formatRelative", () => {
  it("reads forwards and backwards", () => {
    expect(formatRelative(3 * DAY)).toBe("in 3 days");
    expect(formatRelative(-2 * DAY)).toBe("2 days ago");
    expect(formatRelative(5 * HOUR)).toBe("in 5 hours");
    expect(formatRelative(DAY)).toBe("in 1 day");
  });

  it("never says 'in 0 minutes'", () => {
    expect(formatRelative(1000)).toBe("in 1 minute");
  });
});
