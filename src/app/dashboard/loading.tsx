import { Card, CardContent, CardHeader } from "@/components/ui/card";

/** Dashboard skeleton (issue #19) — mirrors the profile/Elo/recent-races layout. */
export default function DashboardLoading() {
  return (
    <div className="shell py-8" aria-busy="true" aria-live="polite">
      <div className="mb-8 h-9 w-40 animate-pulse rounded-md bg-muted" />

      <div className="mb-8 grid gap-6 md:grid-cols-2">
        {[0, 1].map((i) => (
          <Card key={i}>
            <CardHeader>
              <div className="h-5 w-24 animate-pulse rounded-md bg-muted" />
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="h-4 w-32 animate-pulse rounded-md bg-muted" />
              <div className="h-4 w-48 animate-pulse rounded-md bg-muted" />
              <div className="h-16 w-full animate-pulse rounded-md bg-muted" />
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <div className="h-5 w-32 animate-pulse rounded-md bg-muted" />
        </CardHeader>
        <CardContent className="space-y-3">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-8 w-full animate-pulse rounded-md bg-muted" />
          ))}
        </CardContent>
      </Card>
      <span className="sr-only">Loading your dashboard…</span>
    </div>
  );
}
