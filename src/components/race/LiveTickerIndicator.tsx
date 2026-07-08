"use client";

import { cn } from "@/lib/utils";

interface LiveTickerIndicatorProps {
  className?: string;
}

export function LiveTickerIndicator({ className }: LiveTickerIndicatorProps) {
  return (
    <span
      className={cn("flex items-center gap-1.5 text-muted-foreground", className)}
    >
      <span className="size-1.5 rounded-full bg-muted-foreground motion-safe:animate-pulse" />
      live
    </span>
  );
}
