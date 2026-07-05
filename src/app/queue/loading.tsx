import { Card, CardContent, CardHeader } from "@/components/ui/card";

/** Queue page skeleton (issue #19). */
export default function QueueLoading() {
  return (
    <main className="shell-narrow flex flex-1 flex-col py-16 md:py-24" aria-busy="true" aria-live="polite">
      <div className="h-4 w-40 animate-pulse rounded-md bg-muted" />
      <div className="mt-6 flex items-start gap-4">
        <div className="size-11 shrink-0 animate-pulse rounded-lg bg-muted" />
        <div className="flex-1">
          <div className="h-7 w-48 animate-pulse rounded-md bg-muted" />
          <div className="mt-2 h-4 w-full max-w-md animate-pulse rounded-md bg-muted" />
        </div>
      </div>
      <Card className="mt-10">
        <CardHeader>
          <div className="h-5 w-40 animate-pulse rounded-md bg-muted" />
        </CardHeader>
        <CardContent>
          <div className="h-9 w-32 animate-pulse rounded-md bg-muted" />
        </CardContent>
      </Card>
      <span className="sr-only">Loading…</span>
    </main>
  );
}
