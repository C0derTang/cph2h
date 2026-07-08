"use client";

/**
 * The CHALLENGE A FRIEND menu row (issue #124). A slab row that expands in place
 * to reveal the existing `NewChallengeForm` — the challenge-creation flow and
 * its handlers are unchanged; this is presentation only. Kept client-side purely
 * for the open/closed disclosure state.
 */

import { useState } from "react";
import { ChevronDown, Users } from "lucide-react";
import { MenuRowContent, accentStyle } from "@/components/menu/menu-row";
import { NewChallengeForm } from "@/components/challenge/new-challenge-form";
import { cn } from "@/lib/utils";

export function ChallengeMenuRow() {
  const [open, setOpen] = useState(false);

  return (
    <div>
      <button
        type="button"
        className="menu-row"
        style={accentStyle("var(--player-opponent)")}
        aria-expanded={open}
        aria-controls="challenge-panel"
        onClick={() => setOpen((o) => !o)}
      >
        <MenuRowContent
          icon={Users}
          label="Challenge a friend"
          tagline="Create a private race link and send it to someone"
          trailing={
            <ChevronDown
              className={cn(
                "size-5 shrink-0 motion-safe:transition-transform",
                open && "rotate-180",
              )}
              style={{ color: "var(--row-accent)" }}
              aria-hidden
            />
          }
        />
      </button>

      {open && (
        <div
          id="challenge-panel"
          className="mt-3 border-l-2 border-player-opponent/40 pl-3 sm:pl-4"
        >
          <NewChallengeForm />
        </div>
      )}
    </div>
  );
}
