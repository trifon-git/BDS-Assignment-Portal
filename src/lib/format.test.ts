import { describe, expect, it } from "vitest";

import { fromDateTimeLocal, toDateTimeLocal } from "./format";

/**
 * Timezone handling is the kind of thing that looks fine in development on a
 * Copenhagen laptop and then shifts every deadline by two hours once the app is
 * running in a UTC container. These pin the behaviour down.
 */
describe("datetime-local conversion", () => {
  it("reads a winter deadline as Copenhagen time (UTC+1)", () => {
    // 2026-01-15 23:59 CET is 22:59 UTC.
    const ms = fromDateTimeLocal("2026-01-15T23:59");
    expect(new Date(ms).toISOString()).toBe("2026-01-15T22:59:00.000Z");
  });

  it("reads a summer deadline as Copenhagen summer time (UTC+2)", () => {
    // 2026-07-15 23:59 CEST is 21:59 UTC.
    const ms = fromDateTimeLocal("2026-07-15T23:59");
    expect(new Date(ms).toISOString()).toBe("2026-07-15T21:59:00.000Z");
  });

  it("round-trips through the form value in both seasons", () => {
    for (const value of [
      "2026-01-15T23:59",
      "2026-07-15T23:59",
      "2026-09-04T12:00",
      "2026-12-31T00:00",
    ]) {
      expect(toDateTimeLocal(fromDateTimeLocal(value))).toBe(value);
    }
  });

  it("handles the day the clocks go forward", () => {
    // Denmark springs forward on the last Sunday of March 2026 (the 29th).
    const before = fromDateTimeLocal("2026-03-29T01:00");
    const after = fromDateTimeLocal("2026-03-29T04:00");
    expect(new Date(before).toISOString()).toBe("2026-03-29T00:00:00.000Z");
    expect(new Date(after).toISOString()).toBe("2026-03-29T02:00:00.000Z");
  });

  it("returns NaN for junk rather than a silently wrong date", () => {
    // V8 parses "not-a-date:00Z" as the year 2000, so a lenient implementation
    // would turn a typo into a real-looking deadline.
    for (const junk of [
      "not-a-date",
      "",
      "2026-09-04",
      "2026-13-04T10:00",
      "2026-02-31T10:00",
      "2026-09-04T25:00",
    ]) {
      expect(Number.isNaN(fromDateTimeLocal(junk))).toBe(true);
    }
  });
});
