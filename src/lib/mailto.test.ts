import { describe, expect, it } from "vitest";

import { feedbackEmail, joinNames, mailtoHref, teamLinkEmail } from "./mailto";

describe("joinNames", () => {
  it("names nobody as 'your team'", () => {
    expect(joinNames([])).toBe("your team");
  });

  it("names one person plainly", () => {
    expect(joinNames(["Amalie"])).toBe("Amalie");
  });

  it("joins two with 'and'", () => {
    expect(joinNames(["Amalie", "Mikkel"])).toBe("Amalie and Mikkel");
  });

  it("joins three or more with a final 'and'", () => {
    expect(joinNames(["Amalie", "Mikkel", "Sofia"])).toBe(
      "Amalie, Mikkel and Sofia",
    );
  });
});

describe("teamLinkEmail", () => {
  const base = {
    courseCode: "BDS",
    assignment: { title: "Week 4 — Model training", weekNumber: 4, dueAt: Date.UTC(2026, 8, 14, 21, 59) },
    team: { name: "Group 2", shortCode: "BDS-7K2P" },
    members: [{ name: "Amalie" }, { name: "Mikkel" }],
    link: "https://example.com/t/abc123",
  };

  it("puts the course, week, and group in the subject", () => {
    const { subject } = teamLinkEmail(base);
    expect(subject).toBe("BDS · Week 4 · Group 2 — Your group link");
  });

  it("omits the week when the assignment has none", () => {
    const { subject } = teamLinkEmail({
      ...base,
      assignment: { ...base.assignment, weekNumber: null },
    });
    expect(subject).toBe("BDS · Group 2 — Your group link");
  });

  it("reads as a message, not a field dump", () => {
    const { body } = teamLinkEmail(base);
    expect(body).toContain("Hi Amalie and Mikkel");
    expect(body).toContain(base.link);
    expect(body).toContain(base.team.shortCode);
    expect(body).toContain(base.assignment.title);
    expect(body).toMatch(/deadline is/i);
    expect(body).toMatch(/forum/i);
  });
});

describe("feedbackEmail", () => {
  it("puts the course, week, and group in the subject", () => {
    const { subject } = feedbackEmail({
      courseCode: "BDS",
      assignment: { title: "Week 2 — Feature engineering", weekNumber: 2 },
      team: { name: "Group 1" },
      comment: "Nice pipeline, but check the scaling step.",
    });
    expect(subject).toBe("BDS · Week 2 · Group 1 — Feedback on your delivery");
  });

  it("carries the comment verbatim", () => {
    const { body } = feedbackEmail({
      courseCode: "BDS",
      assignment: { title: "Week 2 — Feature engineering", weekNumber: 2 },
      team: { name: "Group 1" },
      comment: "Nice pipeline, but check the scaling step.",
    });
    expect(body).toContain("Nice pipeline, but check the scaling step.");
  });
});

describe("mailtoHref", () => {
  it("comma-joins recipients and percent-encodes subject and body", () => {
    const href = mailtoHref(
      ["a@example.com", "b@example.com"],
      "Hi & bye",
      "line one\nline two",
    );
    expect(href.startsWith("mailto:a@example.com,b@example.com?")).toBe(true);
    expect(href).toContain("subject=Hi%20%26%20bye");
    expect(href).toContain("line%20one%0Aline%20two");
  });
});
