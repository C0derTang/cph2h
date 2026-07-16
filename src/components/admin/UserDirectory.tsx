"use client";

/**
 * Admin user directory (issue #224): searchable table of all users.
 *
 * Self-fetching client component, same pattern as `ReportsQueue` — fetches
 * `/api/admin/users` once on mount (loading/error/retry states), then
 * filters client-side via the pure `filterDirectory` helper as the user
 * types. Table markup follows `src/app/leaderboard/page.tsx`.
 *
 * Self-contained: wiring this into `AdminDashboard.tsx` is a separate
 * follow-up issue — this file is not imported anywhere yet.
 */

import { useCallback, useEffect, useState } from "react";
import { Check, Loader2, Minus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DIRECTORY_LIST_CAP,
  filterDirectory,
  type DirectoryUserDTO,
} from "@/lib/admin/directory";

export function UserDirectory() {
  const [users, setUsers] = useState<DirectoryUserDTO[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/users", { cache: "no-store" });
      if (!res.ok) {
        setError("Couldn't load users.");
        setUsers(null);
        return;
      }
      const data = (await res.json()) as DirectoryUserDTO[];
      setUsers(data);
    } catch {
      setError("Couldn't reach the server.");
      setUsers(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    async function run() {
      await fetchUsers();
    }
    run();
  }, [fetchUsers]);

  const filtered = users ? filterDirectory(users, query) : null;

  return (
    <div className="panel p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="eyebrow text-muted-foreground">User directory</p>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search username or CF handle…"
          aria-label="Search users by username or Codeforces handle"
          className="h-8 w-full max-w-xs rounded-[var(--radius)] border border-border bg-background px-2 font-mono text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />
      </div>

      <div className="mt-4">
        {loading && (
          <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            Loading…
          </p>
        )}

        {!loading && error && (
          <div className="flex flex-col items-start gap-2 py-6">
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
            <Button type="button" size="sm" variant="outline" onClick={fetchUsers}>
              Retry
            </Button>
          </div>
        )}

        {!loading && !error && users && filtered && (
          <>
            <p className="pb-3 text-sm text-muted-foreground">
              {filtered.length} of {users.length} users
              {users.length === DIRECTORY_LIST_CAP && " (showing newest 500)"}
            </p>

            {filtered.length === 0 ? (
              <p className="py-6 text-sm text-muted-foreground">
                No users match your search.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[40rem] text-sm">
                  <thead>
                    <tr className="border-b border-border eyebrow text-muted-foreground">
                      <th className="px-4 py-2.5 text-left font-medium">
                        Username
                      </th>
                      <th className="hidden px-4 py-2.5 text-left font-medium sm:table-cell">
                        Codeforces
                      </th>
                      <th className="hidden px-4 py-2.5 text-right font-medium sm:table-cell">
                        Rating
                      </th>
                      <th className="px-4 py-2.5 text-right font-medium">Elo</th>
                      <th className="hidden px-4 py-2.5 text-right font-medium sm:table-cell">
                        Races
                      </th>
                      <th className="hidden px-4 py-2.5 text-center font-medium sm:table-cell">
                        CF linked
                      </th>
                      <th className="px-4 py-2.5 text-left font-medium">Admin</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((user) => (
                      <tr
                        key={user.id}
                        className="border-b border-border transition-colors last:border-b-0 hover:bg-muted/50"
                      >
                        <td className="px-4 py-3 font-medium">{user.username}</td>

                        <td className="hidden px-4 py-3 font-mono text-xs text-muted-foreground sm:table-cell">
                          {user.cfHandle ? (
                            <a
                              href={`https://codeforces.com/profile/${user.cfHandle}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="hover:text-foreground hover:underline"
                            >
                              {user.cfHandle}
                            </a>
                          ) : (
                            <span>Not linked</span>
                          )}
                        </td>

                        <td className="hidden px-4 py-3 text-right font-mono text-xs tabular-nums text-muted-foreground sm:table-cell">
                          {user.cfRating ?? "—"}
                        </td>

                        <td className="px-4 py-3 text-right font-mono text-sm font-semibold tabular-nums">
                          {user.elo}
                        </td>

                        <td className="hidden px-4 py-3 text-right font-mono text-xs text-muted-foreground tabular-nums sm:table-cell">
                          {user.racesPlayed}
                        </td>

                        <td className="hidden px-4 py-3 text-center sm:table-cell">
                          {user.cfLinked ? (
                            <Check
                              className="mx-auto size-4 text-verdict-ok"
                              aria-label="Linked"
                            />
                          ) : (
                            <Minus
                              className="mx-auto size-4 text-muted-foreground"
                              aria-label="Not linked"
                            />
                          )}
                        </td>

                        <td className="px-4 py-3">
                          {user.isAdmin && <Badge variant="secondary">Admin</Badge>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
