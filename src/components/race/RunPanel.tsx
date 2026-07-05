"use client";

/**
 * Run panel (issue #13): "Run samples" button that submits `code` against a
 * race problem's cached sample tests (via `POST /api/races/[id]/run`, backed
 * by Judge0 CE) and renders per-sample pass/fail.
 *
 * Deliberately standalone — this component takes `code` (and optionally the
 * problem's `samples`, for showing expected output on failure) as props
 * rather than importing the Monaco editor component (issue #12, built in
 * parallel). The race-room assembly (#17) wires this up to the live editor
 * value and the race snapshot's `statement.samples`.
 */

import { useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, Loader2, XCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { RunResponse, RunSampleResult, SampleTest } from "@/lib/types";

interface RunPanelProps {
  raceId: string;
  code: string;
  /** The race problem's cached sample tests, used to show expected output on failure. */
  samples?: SampleTest[];
  className?: string;
}

/** Best-effort human message for a non-200 or `{ ok: false }` response. */
function errorMessageFrom(data: unknown, status: number): string {
  if (data && typeof data === "object") {
    if ("message" in data && typeof (data as { message?: unknown }).message === "string") {
      return (data as { message: string }).message;
    }
    if ("error" in data && typeof (data as { error?: unknown }).error === "string") {
      return (data as { error: string }).error;
    }
  }
  return `Run failed (HTTP ${status}).`;
}

export function RunPanel({ raceId, code, samples, className }: RunPanelProps) {
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<RunSampleResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch(`/api/races/${raceId}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data: unknown = await res.json().catch(() => null);

      if (res.ok && data && typeof data === "object" && (data as RunResponse).ok) {
        const results = (data as Extract<RunResponse, { ok: true }>).results;
        setResults(results);
        const passed = results.filter((r) => r.passed).length;
        if (results.length === 0) {
          toast.info("Run finished — no sample tests to check.");
        } else if (passed === results.length) {
          toast.success(`Run finished — all ${results.length} samples passed.`);
        } else {
          toast.error(`Run finished — ${passed}/${results.length} samples passed.`);
        }
      } else {
        setResults(null);
        const message = errorMessageFrom(data, res.status);
        setError(message);
        toast.error(message);
      }
    } catch {
      setResults(null);
      setError("Could not reach the run service. Try again.");
      toast.error("Could not reach the run service. Try again.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
        <Button
          type="button"
          onClick={run}
          disabled={running || code.trim() === ""}
        >
          {running ? <Loader2 className="animate-spin" aria-hidden /> : null}
          {running ? "Running…" : "Run samples"}
        </Button>
        <span className="text-xs text-muted-foreground">
          Judge0 compiler is GCC 9.2 (C++17) — Codeforces judges on a newer GCC.
        </span>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-2.5 text-sm text-destructive">
          <AlertTriangle className="size-4 shrink-0" aria-hidden />
          {error}
        </div>
      )}

      {results && results.length > 0 && (
        <ul className="flex flex-col gap-2">
          {results.map((result) => (
            <SampleResult
              key={result.sampleIndex}
              result={result}
              expected={samples?.[result.sampleIndex]?.output}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function SampleResult({
  result,
  expected,
}: {
  result: RunSampleResult;
  expected?: string;
}) {
  const isCompileError = Boolean(result.compileOutput);

  return (
    <li
      className={cn(
        "rounded-lg border p-3 text-sm",
        result.passed
          ? "border-emerald-500/30 bg-emerald-500/10"
          : "border-destructive/30 bg-destructive/10",
      )}
    >
      <div className="flex items-center gap-2 font-medium">
        {result.passed ? (
          <CheckCircle2 className="size-4 shrink-0 text-emerald-500" aria-hidden />
        ) : (
          <XCircle className="size-4 shrink-0 text-destructive" aria-hidden />
        )}
        <span>
          Sample {result.sampleIndex + 1} — {result.status}
        </span>
        {result.timeSec != null && (
          <span className="ml-auto font-mono text-xs text-muted-foreground">
            {result.timeSec.toFixed(2)}s
          </span>
        )}
      </div>

      {isCompileError && (
        <pre className="mt-2 overflow-x-auto rounded-md border border-destructive/20 bg-muted/40 p-2 font-mono text-xs whitespace-pre-wrap text-destructive">
          {result.compileOutput}
        </pre>
      )}

      {!result.passed && !isCompileError && (
        <div className="mt-2 grid gap-2 md:grid-cols-2">
          <IoBlock label="Your output" value={result.actualOutput} />
          {expected !== undefined && <IoBlock label="Expected" value={expected} />}
          {result.stderr && <IoBlock label="stderr" value={result.stderr} />}
        </div>
      )}
    </li>
  );
}

function IoBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="font-mono text-[11px] tracking-[0.14em] text-muted-foreground uppercase">
        {label}
      </span>
      <pre className="overflow-x-auto rounded-md border border-border bg-muted/40 p-2 font-mono text-xs whitespace-pre">
        {value || "(empty)"}
      </pre>
    </div>
  );
}
