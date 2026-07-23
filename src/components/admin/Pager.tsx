"use client";

/**
 * Shared pager for the admin dashboard's client-paginated lists (issue #295):
 * `OpsPanel`, `UserDirectory`, `RegistrantsTable`, `ReportsQueue`. Renders
 * nothing when the list already fits on one page.
 */

import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ADMIN_PAGE_SIZE, pageCount } from "@/lib/paging";

export function Pager({
  page,
  total,
  pageSize = ADMIN_PAGE_SIZE,
  onPageChange,
}: {
  page: number;
  total: number;
  pageSize?: number;
  onPageChange: (page: number) => void;
}) {
  if (total <= pageSize) return null;

  const count = pageCount(total, pageSize);

  return (
    <div className="mt-3 flex items-center justify-end gap-2">
      <Button
        type="button"
        size="sm"
        variant="outline"
        aria-label="Previous page"
        disabled={page <= 0}
        onClick={() => onPageChange(page - 1)}
      >
        <ChevronLeft aria-hidden />
      </Button>
      <span className="font-mono text-xs tabular-nums text-muted-foreground">
        Page {page + 1} / {count}
      </span>
      <Button
        type="button"
        size="sm"
        variant="outline"
        aria-label="Next page"
        disabled={page >= count - 1}
        onClick={() => onPageChange(page + 1)}
      >
        <ChevronRight aria-hidden />
      </Button>
    </div>
  );
}
