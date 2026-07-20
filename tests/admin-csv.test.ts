/**
 * Tests for src/lib/admin/csv.ts (issue #221).
 *
 * Escaping order is load-bearing: the formula-injection guard runs first
 * (prefixing `'` to cells that open with `=`, `+`, `-`, `@`, or a tab), THEN
 * RFC 4180 quoting (wrap + double embedded quotes for `"`, `,`, `\r`, `\n`).
 * Rows are CRLF-joined.
 */

import { describe, expect, it } from "vitest";
import { escapeCsvCell, registrantsToCsv, toCsv } from "@/lib/admin/csv";
import type { RegistrantDTO } from "@/lib/admin/registrants";

describe("escapeCsvCell", () => {
  it("passes plain text through unchanged", () => {
    expect(escapeCsvCell("tourist")).toBe("tourist");
  });

  it("quotes a cell containing a comma", () => {
    expect(escapeCsvCell("a,b")).toBe('"a,b"');
  });

  it("quotes a cell containing a double quote and doubles it", () => {
    expect(escapeCsvCell('say "hi"')).toBe('"say ""hi"""');
  });

  it("quotes a cell containing a CR", () => {
    expect(escapeCsvCell("a\rb")).toBe('"a\rb"');
  });

  it("quotes a cell containing a LF", () => {
    expect(escapeCsvCell("a\nb")).toBe('"a\nb"');
  });

  it.each(["=", "+", "-", "@", "\t"])(
    "guards a formula-leading cell starting with %s",
    (lead) => {
      expect(escapeCsvCell(`${lead}cmd()`)).toBe(`'${lead}cmd()`);
    },
  );

  it("does not guard a cell where the special char is not the first character", () => {
    expect(escapeCsvCell("a=b")).toBe("a=b");
  });

  it("applies the formula guard before RFC 4180 quoting for a combined case", () => {
    // Leads with `=` AND contains a comma: guard first, then quote the result.
    expect(escapeCsvCell("=SUM(A1,A2)")).toBe('"\'=SUM(A1,A2)"');
  });
});

describe("toCsv", () => {
  it("joins header + rows with CRLF", () => {
    const csv = toCsv(["a", "b"], [["1", "2"], ["3", "4"]]);
    expect(csv).toBe("a,b\r\n1,2\r\n3,4");
  });

  it("escapes each cell independently", () => {
    const csv = toCsv(["h1", "h2"], [["x,y", "plain"]]);
    expect(csv).toBe('h1,h2\r\n"x,y",plain');
  });
});

describe("registrantsToCsv", () => {
  function makeRegistrant(overrides: Partial<RegistrantDTO> = {}): RegistrantDTO {
    return {
      userId: "user-1",
      username: "tourist",
      cfHandle: "tourist_cf",
      cfRating: 3500,
      firstName: "Grace",
      lastName: "Hopper",
      email: "grace@example.com",
      location: "New York, NY",
      githubUrl: "https://github.com/tourist",
      linkedinUrl: "https://linkedin.com/in/tourist",
      termsAcceptedAt: "2026-07-01T00:00:00.000Z",
      registeredAt: "2026-07-01T00:05:00.000Z",
      ...overrides,
    };
  }

  it("emits the header row in the specified column order", () => {
    const csv = registrantsToCsv([]);
    expect(csv).toBe(
      "username,cfHandle,cfRating,firstName,lastName,email,location,githubUrl,linkedinUrl,termsAcceptedAt,registeredAt",
    );
  });

  it("stringifies numbers via String() and nulls as empty cells", () => {
    const csv = registrantsToCsv([
      makeRegistrant({
        cfHandle: null,
        cfRating: null,
        firstName: null,
        lastName: null,
        email: null,
        location: null,
        githubUrl: null,
        linkedinUrl: null,
      }),
    ]);
    const [, dataLine] = csv.split("\r\n");
    expect(dataLine).toBe(
      "tourist,,,,,,,,,2026-07-01T00:00:00.000Z,2026-07-01T00:05:00.000Z",
    );
  });

  it("includes firstName/lastName/email/location as plain cells", () => {
    const csv = registrantsToCsv([makeRegistrant()]);
    const [, dataLine] = csv.split("\r\n");
    expect(dataLine).toBe(
      "tourist,tourist_cf,3500,Grace,Hopper,grace@example.com,\"New York, NY\",https://github.com/tourist,https://linkedin.com/in/tourist,2026-07-01T00:00:00.000Z,2026-07-01T00:05:00.000Z",
    );
  });

  it("includes cfRating as a plain (unquoted) number string", () => {
    const csv = registrantsToCsv([makeRegistrant({ cfRating: 3500 })]);
    expect(csv).toContain(",3500,");
  });
});
