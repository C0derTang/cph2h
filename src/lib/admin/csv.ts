/**
 * CSV encoding for admin exports (issue #221). Pure, no I/O.
 *
 * Escaping order is load-bearing:
 *   1. Formula-injection guard FIRST — a cell opening with `=`, `+`, `-`,
 *      `@`, or a tab is a formula-injection vector when opened in a
 *      spreadsheet app, so it gets a leading `'` before anything else.
 *   2. RFC 4180 quoting — a cell (guarded or not) containing `"`, `,`, `\r`,
 *      or `\n` is wrapped in double quotes, with embedded quotes doubled.
 *   3. Rows are joined with CRLF (`\r\n`), header row first. No BOM here —
 *      the component prepends the BOM at Blob-creation time.
 */

import type { RegistrantDTO } from "@/lib/admin/registrants";

const FORMULA_LEAD_CHARS = ["=", "+", "-", "@", "\t"];

/** Escape a single cell: formula-injection guard, then RFC 4180 quoting. */
export function escapeCsvCell(value: string): string {
  let cell = value;

  if (FORMULA_LEAD_CHARS.some((c) => cell.startsWith(c))) {
    cell = `'${cell}`;
  }

  if (cell.includes('"') || cell.includes(",") || cell.includes("\r") || cell.includes("\n")) {
    cell = `"${cell.replace(/"/g, '""')}"`;
  }

  return cell;
}

/** Build a full CSV document (header row + data rows), CRLF-joined. */
export function toCsv(headers: string[], rows: string[][]): string {
  const lines = [headers, ...rows].map((row) => row.map(escapeCsvCell).join(","));
  return lines.join("\r\n");
}

const REGISTRANT_HEADERS = [
  "username",
  "cfHandle",
  "cfRating",
  "firstName",
  "lastName",
  "email",
  "location",
  "githubUrl",
  "linkedinUrl",
  "termsAcceptedAt",
  "registeredAt",
];

/** Null → `""`; numbers stringified via `String()`. */
function cellOf(value: string | number | null): string {
  if (value === null) return "";
  return String(value);
}

/** `registrantsToCsv` column order: username, cfHandle, cfRating, firstName,
 *  lastName, email, location, githubUrl, linkedinUrl, termsAcceptedAt,
 *  registeredAt. */
export function registrantsToCsv(registrants: RegistrantDTO[]): string {
  const rows = registrants.map((r) => [
    cellOf(r.username),
    cellOf(r.cfHandle),
    cellOf(r.cfRating),
    cellOf(r.firstName),
    cellOf(r.lastName),
    cellOf(r.email),
    cellOf(r.location),
    cellOf(r.githubUrl),
    cellOf(r.linkedinUrl),
    cellOf(r.termsAcceptedAt),
    cellOf(r.registeredAt),
  ]);
  return toCsv(REGISTRANT_HEADERS, rows);
}
