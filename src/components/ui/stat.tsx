import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Recessed scoreboard tile for a single number + label — the `stat-plate`
 * recipe from docs/design.md (Elo, rank, W/L, streak, race count, ...).
 */
function Stat({
  label,
  value,
  hint,
  valueClassName,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  valueClassName?: string;
  className?: string;
}) {
  return (
    <div className={cn("stat-plate px-3 py-2", className)}>
      <p className="font-mono text-[10px] tracking-[0.18em] text-muted-foreground uppercase">
        {label}
      </p>
      <p
        className={cn(
          "font-display text-2xl font-semibold tabular-nums",
          valueClassName
        )}
      >
        {value}
      </p>
      {hint != null && (
        <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">
          {hint}
        </p>
      )}
    </div>
  );
}

export { Stat };
