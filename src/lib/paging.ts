/**
 * Client-side pagination helpers for the admin dashboard lists (issue #295).
 *
 * Pure and framework-free — no imports from `@/lib/db` — since it's imported
 * by client components (`Pager.tsx` and the four admin list components).
 */

export const ADMIN_PAGE_SIZE = 10;

/** Number of pages for `total` items, always at least 1 (even for 0 items). */
export function pageCount(total: number, pageSize: number = ADMIN_PAGE_SIZE): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

/**
 * Clamps a 0-based page index into `[0, pageCount(total, pageSize) - 1]`.
 * Handles negative pages and pages past the end (e.g. after the underlying
 * list shrinks from a delete/resolve).
 */
export function clampPage(page: number, total: number, pageSize: number = ADMIN_PAGE_SIZE): number {
  const lastPage = pageCount(total, pageSize) - 1;
  return Math.min(Math.max(page, 0), lastPage);
}

/** Slices `items` to the given 0-based page. The last page may be partial. */
export function pageSlice<T>(items: T[], page: number, pageSize: number = ADMIN_PAGE_SIZE): T[] {
  const start = page * pageSize;
  return items.slice(start, start + pageSize);
}
