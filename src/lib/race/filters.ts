/**
 * Challenge-creation problem filters (issue #64).
 *
 * `raceFiltersSchema` is the zod validation shared by `POST /api/races` (body)
 * and `GET /api/problems/availability` (query, after numeric coercion). Kept
 * dependency-light (zod + the shared constants) so the accept/reject matrix
 * is cheap to unit test without a route or the db.
 *
 * All four fields are optional on the wire (omitted = "no constraint"); the
 * persisted/DTO shape (`RaceProblemFilters`, `src/lib/types.ts`) uses `null`
 * for the same meaning. `toRaceProblemFilters` bridges the two.
 */

import { z } from "zod";
import {
  PROBLEM_RATING_CEIL,
  PROBLEM_RATING_FLOOR,
  type RaceProblemFilters,
} from "@/lib/types";

const ratingBoundSchema = z
  .number()
  .int()
  .min(PROBLEM_RATING_FLOOR)
  .max(PROBLEM_RATING_CEIL)
  .multipleOf(100);

/** Strict ISO 8601 datetime (matches `Date.prototype.toISOString()` output). */
const isoDateTimeSchema = z.iso.datetime();

export const raceFiltersSchema = z
  .object({
    ratingMin: ratingBoundSchema.optional(),
    ratingMax: ratingBoundSchema.optional(),
    dateFrom: isoDateTimeSchema.optional(),
    dateTo: isoDateTimeSchema.optional(),
  })
  .refine(
    (v) =>
      v.ratingMin === undefined ||
      v.ratingMax === undefined ||
      v.ratingMin <= v.ratingMax,
    { message: "ratingMin must be <= ratingMax", path: ["ratingMin"] },
  )
  .refine(
    (v) =>
      v.dateFrom === undefined ||
      v.dateTo === undefined ||
      Date.parse(v.dateFrom) <= Date.parse(v.dateTo),
    { message: "dateFrom must be <= dateTo", path: ["dateFrom"] },
  );

export type RaceFiltersInput = z.infer<typeof raceFiltersSchema>;

/**
 * `undefined` (no constraint on the wire) -> `null` (no constraint in the
 * persisted/DTO shape). Assumes `input` already passed `raceFiltersSchema`.
 */
export function toRaceProblemFilters(input: RaceFiltersInput): RaceProblemFilters {
  return {
    ratingMin: input.ratingMin ?? null,
    ratingMax: input.ratingMax ?? null,
    dateFrom: input.dateFrom ?? null,
    dateTo: input.dateTo ?? null,
  };
}

/** True when at least one filter constrains problem selection. */
export function hasAnyFilter(filters: RaceProblemFilters): boolean {
  return (
    filters.ratingMin !== null ||
    filters.ratingMax !== null ||
    filters.dateFrom !== null ||
    filters.dateTo !== null
  );
}
