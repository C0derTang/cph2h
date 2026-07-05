/**
 * Validation for the per-user C++ template (issue #12).
 *
 * Shared between the `PUT /api/settings/template` route and any client-side
 * pre-flight checks. Kept dependency-light (just Zod) so it's cheap to unit
 * test in isolation from the route/db.
 */

import { z } from "zod";

/** Generous cap — a few hundred lines of boilerplate, well under typical text-column limits. */
export const MAX_TEMPLATE_LENGTH = 20_000;

export const templateSchema = z.object({
  template: z
    .string()
    .max(
      MAX_TEMPLATE_LENGTH,
      `Template must be ${MAX_TEMPLATE_LENGTH.toLocaleString()} characters or fewer.`,
    ),
});

export type TemplateInput = z.infer<typeof templateSchema>;

/** Pure size check, useful for client-side validation before hitting the API. */
export function isTemplateSizeValid(template: string): boolean {
  return template.length <= MAX_TEMPLATE_LENGTH;
}
