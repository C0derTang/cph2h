/**
 * Tests for src/lib/paging.ts (issue #295): pure client-side pagination
 * helpers shared by the admin dashboard's four paginated lists.
 */

import { describe, expect, it } from "vitest";
import { ADMIN_PAGE_SIZE, clampPage, pageCount, pageSlice } from "@/lib/paging";

describe("pageCount", () => {
  it("returns 1 for zero items", () => {
    expect(pageCount(0)).toBe(1);
  });

  it("returns exactly total/pageSize for an exact multiple", () => {
    expect(pageCount(20, 10)).toBe(2);
    expect(pageCount(30, 10)).toBe(3);
  });

  it("rounds up for a remainder", () => {
    expect(pageCount(21, 10)).toBe(3);
    expect(pageCount(1, 10)).toBe(1);
  });

  it("defaults to ADMIN_PAGE_SIZE (10) when pageSize is omitted", () => {
    expect(pageCount(25)).toBe(pageCount(25, ADMIN_PAGE_SIZE));
    expect(pageCount(25)).toBe(3);
  });
});

describe("clampPage", () => {
  it("clamps a negative page to 0", () => {
    expect(clampPage(-1, 25, 10)).toBe(0);
    expect(clampPage(-100, 25, 10)).toBe(0);
  });

  it("clamps a page past the end to the last page", () => {
    expect(clampPage(99, 25, 10)).toBe(2); // pages 0,1,2 for 25 items @ 10
  });

  it("passes through a page already in bounds", () => {
    expect(clampPage(1, 25, 10)).toBe(1);
  });

  it("re-clamps to the new last page after the list shrinks (e.g. a delete)", () => {
    // Was on page 2 (items 20-24) of a 25-item list; list shrinks to 12 items,
    // which now has only 2 pages (0, 1) — page 2 no longer exists.
    expect(clampPage(2, 12, 10)).toBe(1);
  });

  it("clamps to page 0 for an empty list regardless of requested page", () => {
    expect(clampPage(5, 0, 10)).toBe(0);
  });
});

describe("pageSlice", () => {
  const items = Array.from({ length: 25 }, (_, i) => i); // 0..24

  it("returns the first full page", () => {
    expect(pageSlice(items, 0, 10)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("returns the last, partial page", () => {
    expect(pageSlice(items, 2, 10)).toEqual([20, 21, 22, 23, 24]);
  });

  it("returns an empty array for a page past the end", () => {
    expect(pageSlice(items, 10, 10)).toEqual([]);
  });

  it("defaults to ADMIN_PAGE_SIZE (10) when pageSize is omitted", () => {
    expect(pageSlice(items, 0)).toEqual(pageSlice(items, 0, ADMIN_PAGE_SIZE));
  });
});
