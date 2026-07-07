"use client";

/**
 * Migration nudge for pre-#111 signups whose `username` is still the old
 * full-email fallback: "Pick a display name" -> /settings/profile.
 *
 * Dismiss state lives in a module-level external store backed by
 * `localStorage`, read via `useSyncExternalStore` — mirrors
 * `useOpponentVolume` in `src/components/race/VolumeControl.tsx`.
 * `getServerSnapshot` returns `false` (not dismissed) so SSR/hydration
 * markup matches; a previously-dismissed banner then disappears immediately
 * post-hydration with no effect-based `setState` flash.
 */

import { useCallback, useSyncExternalStore } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  dismissUsernameBanner,
  isUsernameBannerDismissed,
  looksLikeEmailUsername,
} from "@/lib/username";

type DismissListener = () => void;
const dismissListeners = new Set<DismissListener>();
let cachedDismissed: boolean | null = null;

function getDismissedSnapshot(): boolean {
  if (cachedDismissed === null) cachedDismissed = isUsernameBannerDismissed();
  return cachedDismissed;
}

function getDismissedServerSnapshot(): boolean {
  return false;
}

function subscribeToDismissed(listener: DismissListener): () => void {
  dismissListeners.add(listener);
  return () => dismissListeners.delete(listener);
}

function setDismissed(): void {
  cachedDismissed = true;
  dismissUsernameBanner();
  dismissListeners.forEach((listener) => listener());
}

export function EmailUsernameBanner({ username }: { username: string }) {
  const dismissed = useSyncExternalStore(
    subscribeToDismissed,
    getDismissedSnapshot,
    getDismissedServerSnapshot,
  );
  const dismiss = useCallback(() => setDismissed(), []);

  if (!looksLikeEmailUsername(username) || dismissed) return null;

  return (
    <div className="panel mb-6 flex items-center justify-between gap-3 p-3 text-sm">
      <p className="text-muted-foreground">
        <Link
          href="/settings/profile"
          className="font-medium text-player-self hover:underline"
        >
          Pick a display name
        </Link>{" "}
        — your current name looks like an email address.
      </p>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="Dismiss"
        onClick={dismiss}
      >
        <X className="size-4" aria-hidden />
      </Button>
    </div>
  );
}
