/**
 * 404 boundary. Rendered for genuinely missing routes and — via the proxy
 * middleware — for any app surface an unauthenticated visitor requests: rather
 * than bounce anon visitors to a sign-in wall, protected pages simply don't
 * exist for them. Styling mirrors the root error boundary (src/app/error.tsx).
 */

import Link from "next/link";
import { Ghost } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="shell-narrow flex flex-1 flex-col items-center justify-center gap-4 py-16 text-center md:py-24">
      <div className="flex size-11 shrink-0 items-center justify-center rounded-[var(--radius)] border border-border bg-muted/40 text-muted-foreground">
        <Ghost className="size-5" aria-hidden />
      </div>
      <div>
        <p className="font-mono text-xs tracking-[0.3em] text-muted-foreground uppercase">
          404
        </p>
        <h1 className="mt-1 font-display text-2xl tracking-tight uppercase md:text-3xl">
          Nothing here
        </h1>
        <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground md:text-base">
          This page doesn&apos;t exist, or isn&apos;t yours to see. Head back
          and pick a fight from the menu.
        </p>
      </div>
      <div className="mt-2">
        <Button render={<Link href="/" />} nativeButton={false}>
          Go home
        </Button>
      </div>
    </main>
  );
}
