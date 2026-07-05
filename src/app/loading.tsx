import { Loader2 } from "lucide-react";

/**
 * Root loading fallback (issue #19). Shown by Next.js while a route segment
 * without its own `loading.tsx` is still resolving server data.
 */
export default function RootLoading() {
  return (
    <main className="flex flex-1 items-center justify-center py-24">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden />
        Loading…
      </div>
    </main>
  );
}
