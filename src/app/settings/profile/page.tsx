import { UserRound } from "lucide-react";
import { ensureUser } from "@/lib/user";
import { UsernameForm } from "./username-form";

export default async function ProfileSettingsPage() {
  // Provisions the `users` row on first authenticated access (issue #48) so
  // the form has a real current value to prefill, matching the /settings/cf
  // page's pattern.
  const user = await ensureUser();

  return (
    <main className="shell-narrow flex flex-1 flex-col py-16 md:py-24">
      <p className="font-mono text-xs text-muted-foreground">
        <span className="text-player-self">$</span> cd ~/cph2h/settings/profile
      </p>

      <div className="mt-6 flex items-start gap-4">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-[var(--radius)] border border-player-self/40 bg-player-self/10 text-player-self">
          <UserRound className="size-5" aria-hidden />
        </div>
        <div>
          <h1 className="font-display text-2xl tracking-tight uppercase md:text-3xl">
            Display name
          </h1>
          <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground md:text-base">
            This is what opponents see on the lobby poster, HUD, and
            leaderboard.
          </p>
        </div>
      </div>

      <div className="mt-10">
        <UsernameForm currentUsername={user?.username ?? ""} />
      </div>
    </main>
  );
}
