import { describe, expect, it } from "vitest";

import { parseRoster } from "./roster";

describe("parseRoster", () => {
  it("reads a plain CSV", () => {
    expect(
      parseRoster(
        "Amalie Sørensen,amalie.soerensen@student.aau.dk\n" +
          "Mikkel Jensen,mikkel.jensen@student.aau.dk",
      ),
    ).toEqual([
      { name: "Amalie Sørensen", email: "amalie.soerensen@student.aau.dk" },
      { name: "Mikkel Jensen", email: "mikkel.jensen@student.aau.dk" },
    ]);
  });

  it("reads semicolon-separated CSV, as Danish Excel exports", () => {
    expect(parseRoster("Freja Nielsen;freja@student.aau.dk")).toEqual([
      { name: "Freja Nielsen", email: "freja@student.aau.dk" },
    ]);
  });

  it("reads addresses copied out of an email client", () => {
    expect(
      parseRoster('"Jonas Berg" <jonas.berg@student.aau.dk>'),
    ).toEqual([{ name: "Jonas Berg", email: "jonas.berg@student.aau.dk" }]);
  });

  it("reads the email column with the name after it", () => {
    expect(parseRoster("kasper@student.aau.dk, Kasper Lund")).toEqual([
      { name: "Kasper Lund", email: "kasper@student.aau.dk" },
    ]);
  });

  it("invents a readable name when only an address is given", () => {
    expect(parseRoster("nina.haugen@student.aau.dk")).toEqual([
      { name: "Nina Haugen", email: "nina.haugen@student.aau.dk" },
    ]);
  });

  it("ignores a trailing study number rather than using it as a name", () => {
    expect(parseRoster("emil@student.aau.dk,20231234")).toEqual([
      { name: "Emil", email: "emil@student.aau.dk" },
    ]);
  });

  it("lowercases addresses so re-imports match", () => {
    expect(parseRoster("Clara,Clara.Moeller@Student.AAU.dk")[0].email).toBe(
      "clara.moeller@student.aau.dk",
    );
  });

  it("collapses a duplicated address to one entry", () => {
    const rows = parseRoster(
      "Yusuf Demir,yusuf@student.aau.dk\nYusuf,yusuf@student.aau.dk",
    );
    expect(rows).toHaveLength(1);
  });

  it("skips headers, blank lines, and anything without an address", () => {
    const rows = parseRoster(
      "Name,Email\n\nTotal: 3 students\nAnders Bak,anders@student.aau.dk\n   \n",
    );
    expect(rows).toEqual([
      { name: "Anders Bak", email: "anders@student.aau.dk" },
    ]);
  });

  it("returns nothing for text with no addresses at all", () => {
    expect(parseRoster("just some notes\nno emails here")).toEqual([]);
  });
});
