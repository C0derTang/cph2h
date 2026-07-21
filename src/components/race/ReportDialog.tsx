"use client";

/**
 * Report-opponent dialog (issue #174).
 *
 * A plain `Dialog` (not `AlertDialog`) since this is a form, not a
 * destructive irreversible confirm — outside-press/Escape dismissal is fine
 * here. Posts `CreateReportRequest` to `POST /api/reports`; the server
 * derives `reportedId`, so this component only ever sends `{ raceId, reason,
 * note }`. Filing a report is presentational-only: it changes nothing about
 * the race client-side, just the request + a success/error state in the
 * dialog itself.
 */

import { useId, useState } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { CircleCheck, Loader2, ShieldAlert } from "lucide-react";

import { SlabButton } from "@/components/menu/slab-button";
import { REPORT_REASONS, type ReportReason } from "@/lib/types";

const REASON_LABELS: Record<ReportReason, string> = {
  cheating: "Cheating",
  av_violation: "Camera/audio violation",
  abusive: "Abusive behavior",
  other: "Other",
};

const NOTE_MAX_LEN = 1000;

type SubmitState =
  | { phase: "form" }
  | { phase: "submitting" }
  | { phase: "success" }
  | { phase: "already_reported" }
  | { phase: "error"; message: string };

interface ReportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  raceId: string;
}

export function ReportDialog({ open, onOpenChange, raceId }: ReportDialogProps) {
  const [reason, setReason] = useState<ReportReason>("cheating");
  const [note, setNote] = useState("");
  const [state, setState] = useState<SubmitState>({ phase: "form" });
  const reasonId = useId();
  const noteId = useId();

  const submitting = state.phase === "submitting";

  function resetAndClose() {
    onOpenChange(false);
    // Reset after the close animation would otherwise flash the form under
    // the outgoing success/error copy; a plain timeout-free reset is fine
    // since the dialog unmounts its content via base-ui's own exit handling.
    setState({ phase: "form" });
    setReason("cheating");
    setNote("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setState({ phase: "submitting" });
    try {
      const res = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          raceId,
          reason,
          note: note.trim() ? note.trim() : undefined,
        }),
      });
      if (res.status === 201) {
        setState({ phase: "success" });
        return;
      }
      if (res.status === 409) {
        setState({ phase: "already_reported" });
        return;
      }
      setState({
        phase: "error",
        message: "Something went wrong filing the report. Try again.",
      });
    } catch {
      setState({
        phase: "error",
        message: "Something went wrong filing the report. Try again.",
      });
    }
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          resetAndClose();
        } else {
          onOpenChange(true);
        }
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-background/95 motion-safe:animate-in motion-safe:fade-in motion-safe:duration-150" />
        <Dialog.Popup
          data-testid="report-dialog"
          className="panel clip-notch fixed top-1/2 left-1/2 z-50 flex w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 flex-col gap-4 p-5 motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-95 motion-safe:duration-150"
        >
          {state.phase === "success" ? (
            <>
              <div className="flex flex-col items-center gap-2 py-2 text-center">
                <CircleCheck className="size-8 text-verdict-ok" aria-hidden />
                <Dialog.Title className="font-display text-lg tracking-tight uppercase">
                  Report filed
                </Dialog.Title>
                <Dialog.Description className="text-sm text-muted-foreground">
                  Thanks. A moderator will take a look.
                </Dialog.Description>
              </div>
              <SlabButton
                type="button"
                tone="neutral"
                data-testid="report-dialog-close"
                onClick={resetAndClose}
              >
                Close
              </SlabButton>
            </>
          ) : state.phase === "already_reported" ? (
            <>
              <div className="flex flex-col gap-1.5">
                <Dialog.Title className="flex items-center gap-2 font-display text-lg tracking-tight uppercase">
                  <ShieldAlert className="size-4 text-muted-foreground" aria-hidden />
                  Already reported
                </Dialog.Title>
                <Dialog.Description className="text-sm text-muted-foreground">
                  You already reported this race.
                </Dialog.Description>
              </div>
              <SlabButton
                type="button"
                tone="neutral"
                data-testid="report-dialog-close"
                onClick={resetAndClose}
              >
                Close
              </SlabButton>
            </>
          ) : (
            <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
              <div className="flex flex-col gap-1.5">
                <Dialog.Title className="flex items-center gap-2 font-display text-lg tracking-tight uppercase">
                  <ShieldAlert className="size-4 text-destructive" aria-hidden />
                  Report opponent
                </Dialog.Title>
                <Dialog.Description className="text-sm text-muted-foreground">
                  Flag a rules or conduct violation for a moderator to review.
                </Dialog.Description>
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor={reasonId} className="eyebrow text-muted-foreground">
                  Reason
                </label>
                <select
                  id={reasonId}
                  data-testid="report-reason-select"
                  className="h-9 rounded-[var(--radius)] border border-border bg-background px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60"
                  value={reason}
                  onChange={(e) => setReason(e.target.value as ReportReason)}
                  disabled={submitting}
                  required
                >
                  {REPORT_REASONS.map((r) => (
                    <option key={r} value={r}>
                      {REASON_LABELS[r]}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor={noteId} className="eyebrow text-muted-foreground">
                  Note (optional)
                </label>
                <textarea
                  id={noteId}
                  data-testid="report-note-textarea"
                  className="min-h-20 resize-y rounded-[var(--radius)] border border-border bg-background p-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60"
                  value={note}
                  onChange={(e) => setNote(e.target.value.slice(0, NOTE_MAX_LEN))}
                  maxLength={NOTE_MAX_LEN}
                  disabled={submitting}
                  placeholder="Anything that helps a moderator understand what happened."
                />
                <span className="text-right text-xs text-muted-foreground">
                  {note.length}/{NOTE_MAX_LEN}
                </span>
              </div>

              {state.phase === "error" && (
                <p role="alert" className="text-sm text-destructive">
                  {state.message}
                </p>
              )}

              <div className="flex justify-end gap-2">
                <SlabButton
                  type="button"
                  tone="neutral"
                  data-testid="report-dialog-cancel"
                  onClick={resetAndClose}
                  disabled={submitting}
                >
                  Cancel
                </SlabButton>
                <SlabButton
                  type="submit"
                  tone="destructive"
                  data-testid="report-dialog-submit"
                  disabled={submitting}
                >
                  {submitting ? (
                    <Loader2 className="animate-spin" aria-hidden />
                  ) : (
                    <ShieldAlert aria-hidden />
                  )}
                  {submitting ? "Filing report…" : "File report"}
                </SlabButton>
              </div>
            </form>
          )}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
