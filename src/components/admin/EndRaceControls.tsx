"use client";

/**
 * Admin end-race controls (issue #296) — a two-step inline confirm that POSTs
 * `/api/admin/races/[id]/end`. Rendered on non-terminal race rows in the ops
 * panel and in the admin race spectator.
 *
 * "End…" expands to the available actions: `Abort (no Elo)` always, plus
 * `{winner} wins` for each side only when the race is `active` and has a p2.
 * The button stays disabled while the request is in flight; a 409 (the race
 * changed underneath us) surfaces a "refresh" toast. `onEnded()` fires either
 * way so the caller refetches its snapshot immediately.
 *
 * Types-only import from `@/lib/admin/race-end` (erases at build) — this client
 * component never runtime-imports `@/lib/db`.
 */

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { AdminEndRequest } from "@/lib/admin/race-end";

interface Player {
  id: string;
  username: string;
}

export function EndRaceControls({
  raceId,
  status,
  p1,
  p2,
  onEnded,
}: {
  raceId: string;
  status: string;
  p1: Player;
  p2: Player | null;
  onEnded: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [pending, setPending] = useState(false);

  if (status === "finished" || status === "aborted") return null;

  async function send(request: AdminEndRequest) {
    setPending(true);
    try {
      const res = await fetch(`/api/admin/races/${raceId}/end`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });
      if (res.ok) {
        toast.success(request.action === "abort" ? "Race aborted." : "Winner declared.");
      } else if (res.status === 409) {
        toast.error("Race state changed — refresh");
      } else {
        toast.error("Couldn't end the race.");
      }
    } catch {
      toast.error("Couldn't reach the server.");
    } finally {
      setPending(false);
      setExpanded(false);
      onEnded();
    }
  }

  if (!expanded) {
    return (
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => setExpanded(true)}
      >
        End…
      </Button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        type="button"
        size="sm"
        variant="destructive"
        disabled={pending}
        onClick={() => send({ action: "abort" })}
      >
        Abort (no Elo)
      </Button>

      {status === "active" && p2 && (
        <>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => send({ action: "declare_winner", winnerId: p1.id })}
          >
            {p1.username} wins
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => send({ action: "declare_winner", winnerId: p2.id })}
          >
            {p2.username} wins
          </Button>
        </>
      )}

      <Button
        type="button"
        size="sm"
        variant="ghost"
        disabled={pending}
        onClick={() => setExpanded(false)}
      >
        Cancel
      </Button>
    </div>
  );
}
