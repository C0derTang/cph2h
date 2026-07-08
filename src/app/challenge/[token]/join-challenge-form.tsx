"use client";

/**
 * Client half of the join page (issue #16). Calls `POST /api/races/join`
 * (issue #7) — the only place a challenge race actually transitions
 * `pending -> ready` — then redirects into the race room on success.
 */

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SlabButton } from "@/components/menu/slab-button";
import { Badge } from "@/components/ui/badge";
import type { PublicUser, RaceSnapshot } from "@/lib/types";

interface JoinChallengeFormProps {
  token: string;
  raceId: string;
  challenger: PublicUser;
  timeLimitSec: number;
}

export function JoinChallengeForm({
  token,
  raceId,
  challenger,
  timeLimitSec,
}: JoinChallengeFormProps) {
  const router = useRouter();
  const [joining, setJoining] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);

  async function handleJoin() {
    setJoining(true);
    setError(null);
    setErrorCode(null);
    try {
      const res = await fetch("/api/races/join", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const message = joinErrorMessage(data?.error);
        setError(message);
        setErrorCode(data?.error ?? null);
        toast.error(message);
        return;
      }
      const snapshot = data as RaceSnapshot;
      toast.success("Joined the race!");
      router.push(`/race/${snapshot.id}`);
    } catch {
      setError("Network error — please try again.");
      toast.error("Network error — please try again.");
    } finally {
      setJoining(false);
    }
  }

  async function handleDecline() {
    setDeclining(true);
    setError(null);
    setErrorCode(null);
    try {
      const res = await fetch(`/api/races/${raceId}/abort`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ challengeToken: token }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const message = joinErrorMessage(data?.error);
        setError(message);
        setErrorCode(data?.error ?? null);
        toast.error(message);
        return;
      }
      toast.success("Challenge declined.");
      router.refresh();
    } catch {
      setError("Network error — please try again.");
      toast.error("Network error — please try again.");
    } finally {
      setDeclining(false);
    }
  }

  return (
    <div className="panel max-w-lg p-5">
      <div className="flex flex-col gap-1">
        <h2 className="font-display text-lg tracking-tight uppercase">
          {challenger.username}
        </h2>
        <p className="text-sm text-muted-foreground">
          Elo {challenger.elo}
          {challenger.cfHandle ? ` · ${challenger.cfHandle}` : ""}
        </p>
      </div>
      <div className="mt-4 flex flex-col gap-4">
        <Badge variant="outline" className="w-fit">
          {Math.round(timeLimitSec / 60)} min race
        </Badge>

        {error && (
          <div className="flex flex-col gap-2">
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
            {errorCode === "cf_not_linked" && (
              <Button
                render={<Link href="/settings/cf" />}
                nativeButton={false}
                variant="outline"
                size="sm"
                className="self-start"
              >
                Link Codeforces account
              </Button>
            )}
          </div>
        )}

        {isTerminalJoinError(errorCode) ? (
          <SlabButton
            tone="neutral"
            className="w-fit"
            render={<Link href="/queue" />}
            nativeButton={false}
          >
            Find another race
          </SlabButton>
        ) : (
          <div className="flex flex-wrap gap-2">
            <SlabButton
              type="button"
              tone="self"
              onClick={handleJoin}
              disabled={joining || declining}
            >
              {joining ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                  Joining…
                </>
              ) : (
                "Join race"
              )}
            </SlabButton>
            <SlabButton
              type="button"
              tone="neutral"
              onClick={handleDecline}
              disabled={joining || declining}
              data-testid="decline-challenge-btn"
            >
              {declining ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                  Declining…
                </>
              ) : (
                "Decline"
              )}
            </SlabButton>
          </div>
        )}
      </div>
    </div>
  );
}

/** Errors where retrying the same join is never going to succeed. */
function isTerminalJoinError(error: string | null): boolean {
  return (
    error === "self_join" ||
    error === "already_has_opponent" ||
    error === "conflict" ||
    error === "not_pending" ||
    error === "not_found" ||
    error === "invalid_token"
  );
}

function joinErrorMessage(error?: string): string {
  switch (error) {
    case "self_join":
      return "You can’t join your own challenge.";
    case "already_has_opponent":
    case "conflict":
      return "Someone already joined this challenge.";
    case "not_pending":
      return "This challenge is no longer open.";
    case "not_found":
      return "This challenge link is invalid.";
    case "invalid_token":
      return "This challenge link is invalid.";
    case "cf_not_linked":
      return "Link your Codeforces account first.";
    default:
      return "Could not join the race. Try again.";
  }
}
