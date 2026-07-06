"use client";

/**
 * Root error boundary (issue #19). Next.js renders this in place of any page
 * segment that throws during render — a last line of defense so a bug or a
 * transient DB/network failure never shows the user a blank white screen.
 */

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[app] unhandled error boundary:", error);
  }, [error]);

  return (
    <main className="shell-narrow flex flex-1 flex-col items-center justify-center gap-4 py-16 text-center md:py-24">
      <div className="flex size-11 shrink-0 items-center justify-center rounded-[var(--radius)] border border-destructive/40 bg-destructive/10 text-destructive">
        <AlertTriangle className="size-5" aria-hidden />
      </div>
      <div>
        <h1 className="font-display text-2xl tracking-tight uppercase md:text-3xl">
          Something went wrong
        </h1>
        <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground md:text-base">
          An unexpected error interrupted this page. You can try again, or
          head back home.
        </p>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <Button type="button" onClick={reset}>
          <RotateCcw aria-hidden />
          Try again
        </Button>
        <Button render={<Link href="/" />} nativeButton={false} variant="outline">
          Go home
        </Button>
      </div>
    </main>
  );
}
