"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Ticket } from "lucide-react";
import { SlabButton } from "@/components/menu/slab-button";
import { ENTRY_USD } from "@/lib/tournament";
import type { TournamentRegisterResponse } from "@/lib/types";

const ERROR_MESSAGES: Record<string, string> = {
  full: "The tournament is full — all 128 spots are taken.",
  already_registered: "You're already registered.",
  cf_not_linked: "Link your Codeforces account first.",
  unauthorized: "Please sign in to register.",
  payments_unavailable: "Registration isn't open yet. Check back soon.",
};

/**
 * Kicks off Stripe Checkout. POSTs to the register route and redirects to the
 * returned session URL; maps error codes to a toast. Payment state itself is
 * decided server-side by the webhook, never here.
 */
export function RegisterButton() {
  const [loading, setLoading] = useState(false);

  async function register() {
    setLoading(true);
    try {
      const res = await fetch("/api/tournament/register", { method: "POST" });
      const data: TournamentRegisterResponse = await res.json();
      if ("url" in data) {
        window.location.href = data.url;
        return; // keep the spinner during the redirect
      }
      toast.error(ERROR_MESSAGES[data.error] ?? "Couldn't start registration.");
    } catch {
      toast.error("Couldn't start registration. Try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <SlabButton
      tone="self"
      size="lg"
      onClick={register}
      disabled={loading}
    >
      <Ticket className="size-5" aria-hidden />
      {loading ? "Starting checkout…" : `Register — $${ENTRY_USD}`}
    </SlabButton>
  );
}
