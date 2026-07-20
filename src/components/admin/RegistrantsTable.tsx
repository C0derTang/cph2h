"use client";

/**
 * Admin tournament registrants panel (issue #221): self-fetches
 * `GET /api/admin/registrations` and renders a leaderboard-style table plus
 * a client-side CSV export. Self-contained — not wired into `AdminDashboard`
 * yet (separate follow-up issue).
 *
 * SECURITY (load-bearing): `githubUrl`/`linkedinUrl` are free-text DB
 * columns. They render as a clickable `<a href>` ONLY when the value matches
 * `/^https?:\/\//i` — anything else (including a `javascript:` URL) renders
 * as inert plain text.
 *
 * `email` (issue #239) is ALWAYS rendered as plain text — never through
 * `LinkCell` or a `mailto:` anchor — since it's free-text and unverified.
 */

import { useCallback, useEffect, useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { registrantsToCsv } from "@/lib/admin/csv";
import type { RegistrantDTO } from "@/lib/admin/registrants";

const SAFE_URL_RE = /^https?:\/\//i;

function LinkCell({ url }: { url: string | null }) {
  if (!url) {
    return <span className="text-muted-foreground">—</span>;
  }
  if (!SAFE_URL_RE.test(url)) {
    return <span>{url}</span>;
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="text-primary hover:underline"
    >
      {url}
    </a>
  );
}

function downloadCsv(registrants: RegistrantDTO[]) {
  const csv = registrantsToCsv(registrants);
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "registrants.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function RegistrantsTable() {
  const [registrants, setRegistrants] = useState<RegistrantDTO[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchRegistrants = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/registrations", { cache: "no-store" });
      if (!res.ok) {
        setError("Couldn't load registrants.");
        setRegistrants(null);
        return;
      }
      const data = (await res.json()) as RegistrantDTO[];
      setRegistrants(data);
    } catch {
      setError("Couldn't reach the server.");
      setRegistrants(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    async function run() {
      await fetchRegistrants();
    }
    run();
  }, [fetchRegistrants]);

  return (
    <div className="panel p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <p className="eyebrow text-muted-foreground">Tournament registrants</p>
          {registrants && (
            <span className="font-mono text-xs text-muted-foreground">
              ({registrants.length})
            </span>
          )}
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={!registrants || registrants.length === 0}
          onClick={() => registrants && downloadCsv(registrants)}
        >
          <Download className="size-3.5" aria-hidden />
          Export CSV
        </Button>
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
            <Button type="button" size="sm" variant="outline" onClick={fetchRegistrants}>
              Retry
            </Button>
          </div>
        )}

        {!loading && !error && registrants && registrants.length === 0 && (
          <p className="py-6 text-sm text-muted-foreground">No registrants yet.</p>
        )}

        {!loading && !error && registrants && registrants.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-sm">
              <thead>
                <tr className="border-b border-border eyebrow text-muted-foreground">
                  <th className="px-4 py-2.5 text-left font-medium">Player</th>
                  <th className="px-4 py-2.5 text-left font-medium">Name</th>
                  <th className="px-4 py-2.5 text-left font-medium">Email</th>
                  <th className="px-4 py-2.5 text-left font-medium">CF handle</th>
                  <th className="px-4 py-2.5 text-right font-medium">Rating</th>
                  <th className="hidden px-4 py-2.5 text-left font-medium sm:table-cell">
                    GitHub
                  </th>
                  <th className="hidden px-4 py-2.5 text-left font-medium sm:table-cell">
                    LinkedIn
                  </th>
                  <th className="hidden px-4 py-2.5 text-left font-medium sm:table-cell">
                    Registered
                  </th>
                </tr>
              </thead>
              <tbody>
                {registrants.map((r) => {
                  const fullName = [r.firstName, r.lastName].filter(Boolean).join(" ");
                  return (
                    <tr
                      key={r.userId}
                      className="border-b border-border transition-colors last:border-b-0 hover:bg-muted/50"
                    >
                      <td className="px-4 py-3 font-medium">{r.username}</td>
                      <td className="px-4 py-3">
                        {fullName ? fullName : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {r.email ? r.email : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs">
                        {r.cfHandle ? (
                          <a
                            href={`https://codeforces.com/profile/${r.cfHandle}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary hover:underline"
                          >
                            {r.cfHandle}
                          </a>
                        ) : (
                          <span className="text-muted-foreground">Not linked</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums">
                        {r.cfRating ?? "—"}
                      </td>
                      <td className="hidden px-4 py-3 sm:table-cell">
                        <LinkCell url={r.githubUrl} />
                      </td>
                      <td className="hidden px-4 py-3 sm:table-cell">
                        <LinkCell url={r.linkedinUrl} />
                      </td>
                      <td className="hidden px-4 py-3 font-mono text-xs text-muted-foreground sm:table-cell">
                        {new Date(r.registeredAt).toLocaleString()}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
