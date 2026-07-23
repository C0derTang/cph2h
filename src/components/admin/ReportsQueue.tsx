"use client";

/**
 * Admin dashboard reports queue (issue #176): filter tabs, expandable rows
 * with the auto-attached submission timeline as evidence, and a resolve
 * action. Self-contained — owns its own fetching against the endpoints #175
 * specs (`GET /api/admin/reports?status=`, `GET
 * /api/admin/reports/[id]/evidence`, `PATCH /api/admin/reports/[id]`), the
 * same "component fetches its own data" pattern as `Lobby`/`QueuePage`.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ChevronDown, ChevronRight, ExternalLink, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Pager } from "@/components/admin/Pager";
import { cn } from "@/lib/utils";
import { clampPage, pageSlice } from "@/lib/paging";
import { formatReportReason } from "@/lib/format";
import {
  deriveRaceDuration,
  groupEvidenceByPlayer,
  type EvidenceResponse,
} from "@/lib/report-evidence";
import type { ReportDTO, ReportStatus } from "@/lib/types";

type StatusFilter = ReportStatus | "all";

const TABS: { value: StatusFilter; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "resolved", label: "Resolved" },
  { value: "all", label: "All" },
];

type EvidenceState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: EvidenceResponse };

export function ReportsQueue() {
  const [filter, setFilter] = useState<StatusFilter>("open");
  const [reports, setReports] = useState<ReportDTO[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [evidence, setEvidence] = useState<Record<string, EvidenceState>>({});
  const [resolving, setResolving] = useState<Record<string, boolean>>({});
  const [page, setPage] = useState(0);

  const fetchReports = useCallback(async (status: StatusFilter) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/reports?status=${status}`, {
        cache: "no-store",
      });
      if (!res.ok) {
        setError("Couldn't load reports.");
        setReports(null);
        return;
      }
      const data = (await res.json()) as ReportDTO[];
      setReports(data);
    } catch {
      setError("Couldn't reach the server.");
      setReports(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    async function run() {
      await fetchReports(filter);
    }
    run();
  }, [filter, fetchReports]);

  function selectFilter(next: StatusFilter) {
    setFilter(next);
    setExpandedId(null);
    setPage(0);
  }

  function changePage(next: number) {
    setPage(next);
    setExpandedId(null);
  }

  const loadEvidence = useCallback(async (reportId: string) => {
    setEvidence((prev) => ({ ...prev, [reportId]: { status: "loading" } }));
    try {
      const res = await fetch(`/api/admin/reports/${reportId}/evidence`, {
        cache: "no-store",
      });
      if (!res.ok) {
        setEvidence((prev) => ({
          ...prev,
          [reportId]: { status: "error", message: "Couldn't load evidence." },
        }));
        return;
      }
      const data = (await res.json()) as EvidenceResponse;
      setEvidence((prev) => ({ ...prev, [reportId]: { status: "ready", data } }));
    } catch {
      setEvidence((prev) => ({
        ...prev,
        [reportId]: { status: "error", message: "Couldn't reach the server." },
      }));
    }
  }, []);

  function toggleExpand(reportId: string) {
    const next = expandedId === reportId ? null : reportId;
    setExpandedId(next);
    if (next && !evidence[next]) {
      loadEvidence(next);
    }
  }

  async function resolveReport(report: ReportDTO) {
    setResolving((prev) => ({ ...prev, [report.id]: true }));
    // Optimistic update: an "open"-filtered list drops the row immediately;
    // "resolved"/"all" mark it resolved in place.
    const previous = reports;
    setReports((prev) => {
      if (!prev) return prev;
      if (filter === "open") return prev.filter((r) => r.id !== report.id);
      return prev.map((r) =>
        r.id === report.id
          ? { ...r, status: "resolved" as const, resolvedAt: new Date().toISOString() }
          : r,
      );
    });

    try {
      const res = await fetch(`/api/admin/reports/${report.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "resolved" }),
      });

      if (res.status === 409) {
        toast.error("Someone else already resolved this report.");
        await fetchReports(filter);
        return;
      }

      if (!res.ok) {
        setReports(previous);
        toast.error("Couldn't resolve the report. Try again.");
        return;
      }

      const updated = (await res.json().catch(() => null)) as ReportDTO | null;
      if (updated) {
        setReports((prev) => {
          if (!prev) return prev;
          if (filter === "open") return prev; // already dropped optimistically
          return prev.map((r) => (r.id === updated.id ? updated : r));
        });
      }
      toast.success("Report resolved.");
    } catch {
      setReports(previous);
      toast.error("Couldn't reach the server. Try again.");
    } finally {
      setResolving((prev) => ({ ...prev, [report.id]: false }));
    }
  }

  return (
    <div className="panel p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="eyebrow text-muted-foreground">Reports queue</p>
        <div className="flex gap-1.5" role="tablist" aria-label="Filter reports by status">
          {TABS.map((tab) => (
            <Button
              key={tab.value}
              type="button"
              size="sm"
              variant={filter === tab.value ? "default" : "outline"}
              role="tab"
              aria-selected={filter === tab.value}
              onClick={() => selectFilter(tab.value)}
            >
              {tab.label}
            </Button>
          ))}
        </div>
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
            <Button type="button" size="sm" variant="outline" onClick={() => fetchReports(filter)}>
              Retry
            </Button>
          </div>
        )}

        {!loading && !error && reports && reports.length === 0 && (
          <p className="py-6 text-sm text-muted-foreground">
            {filter === "open"
              ? "Queue's clean. No open reports."
              : "No reports match this filter."}
          </p>
        )}

        {!loading && !error && reports && reports.length > 0 && (
          <>
            <ul className="divide-y divide-border">
              {pageSlice(reports, clampPage(page, reports.length)).map((report) => (
                <ReportRow
                  key={report.id}
                  report={report}
                  expanded={expandedId === report.id}
                  onToggle={() => toggleExpand(report.id)}
                  onResolve={() => resolveReport(report)}
                  resolving={Boolean(resolving[report.id])}
                  evidenceState={evidence[report.id]}
                />
              ))}
            </ul>
            <Pager
              page={clampPage(page, reports.length)}
              total={reports.length}
              onPageChange={changePage}
            />
          </>
        )}
      </div>
    </div>
  );
}

function ReportRow({
  report,
  expanded,
  onToggle,
  onResolve,
  resolving,
  evidenceState,
}: {
  report: ReportDTO;
  expanded: boolean;
  onToggle: () => void;
  onResolve: () => void;
  resolving: boolean;
  evidenceState: EvidenceState | undefined;
}) {
  return (
    <li className="py-3">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          className="flex flex-1 flex-wrap items-center gap-3 text-left"
        >
          {expanded ? (
            <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          ) : (
            <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          )}
          <Badge variant={report.status === "open" ? "verdict-pending" : "outline"}>
            {formatReportReason(report.reason)}
          </Badge>
          <span className="font-mono text-xs">
            <span className="text-player-self">{report.reporter.username}</span>
            <span className="text-muted-foreground"> → </span>
            <span className="text-player-opponent">{report.reported.username}</span>
          </span>
          <span className="font-mono text-[10px] text-muted-foreground">
            {new Date(report.createdAt).toLocaleString()}
          </span>
        </button>

        <Link
          href={`/race/${report.raceId}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 font-mono text-[11px] text-muted-foreground hover:text-foreground hover:underline"
        >
          Race
          <ExternalLink className="size-3" aria-hidden />
        </Link>

        {report.status === "open" && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={onResolve}
            disabled={resolving}
          >
            {resolving ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null}
            Resolve
          </Button>
        )}
      </div>

      {expanded && (
        <div className="stat-plate mt-3 p-3">
          <EvidencePanel report={report} state={evidenceState} />
        </div>
      )}
    </li>
  );
}

function EvidencePanel({
  report,
  state,
}: {
  report: ReportDTO;
  state: EvidenceState | undefined;
}) {
  if (!state || state.status === "loading") {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden />
        Loading…
      </p>
    );
  }

  if (state.status === "error") {
    return (
      <p role="alert" className="text-sm text-destructive">
        {state.message}
      </p>
    );
  }

  const groups = groupEvidenceByPlayer(state.data.report, state.data.submissions);
  const duration = deriveRaceDuration(state.data.race);

  return (
    <div className="flex flex-col gap-3">
      {report.note && (
        <p className="text-sm">
          <span className="eyebrow text-muted-foreground">Note </span>
          {report.note}
        </p>
      )}
      {duration && (
        <p className="text-sm">
          <span className="eyebrow text-muted-foreground">Duration </span>
          <span className="font-mono text-xs">{duration.label}</span>
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        {groups.map((group) => (
          <div key={group.user.id} className="flex flex-col gap-1.5">
            <p
              className={cn(
                "eyebrow",
                group.user.id === report.reporter.id
                  ? "text-player-self"
                  : "text-player-opponent",
              )}
            >
              {group.user.username}
            </p>
            {group.submissions.length === 0 ? (
              <p className="font-mono text-xs text-muted-foreground">No submissions.</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {group.submissions.map((s, i) => (
                  <li
                    key={`${s.submittedAt}-${i}`}
                    className="flex items-center justify-between gap-2 font-mono text-xs"
                  >
                    <span className="text-foreground">{s.verdict ?? "PENDING"}</span>
                    <span className="text-muted-foreground">
                      {new Date(s.submittedAt).toLocaleString()}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
