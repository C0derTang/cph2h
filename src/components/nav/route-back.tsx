"use client";

/**
 * RouteBack — the on-screen Back affordance for the app's sub-surfaces
 * (leaderboard, queue, challenge, settings, race). Rendered once in the root
 * layout, just under the header: a single top-left SlabButton (the same slab
 * language as the landing CTA row) that returns to the play hub. Only appears
 * on back routes (see nav-routes) and only for signed-in visitors — a
 * signed-out visitor's way out is the wordmark / auth chip in the header.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Show } from "@clerk/nextjs";
import { ArrowLeft } from "lucide-react";
import { SlabButton } from "@/components/menu/slab-button";
import { isBackRoute } from "@/lib/nav-routes";

export function RouteBack() {
  const pathname = usePathname();
  if (!isBackRoute(pathname)) return null;

  return (
    <Show when="signed-in">
      <div className="shell pt-4">
        <SlabButton
          tone="neutral"
          render={<Link href="/dashboard" />}
          nativeButton={false}
        >
          <ArrowLeft aria-hidden />
          Back
        </SlabButton>
      </div>
    </Show>
  );
}
