import Link from "next/link";
import {
  CheckCircle2,
  Link2,
  LogIn,
  MessageCircle,
  Trophy,
  UserPlus,
} from "lucide-react";
import { HeroWord } from "@/components/hud/hero-word";
import { SlabButton } from "@/components/menu/slab-button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { ensureUser } from "@/lib/user";
import {
  DISCORD_URL,
  ENTRY_USD,
  PRIZE_USD,
  TOURNAMENT_CAP,
  getRegistration,
  listPaidRegistrants,
} from "@/lib/tournament";
import { RegisterButton } from "./register-button";

export const metadata = {
  title: "Tournament · cph2h",
  description: `The inaugural cph2h tournament — up to ${TOURNAMENT_CAP} players, $${ENTRY_USD} entry, $${PRIZE_USD} prize pool.`,
};

const FORMAT = [
  {
    n: "01",
    title: "Register",
    body: `Pay the $${ENTRY_USD} entry and claim one of ${TOURNAMENT_CAP} seats. Account + linked Codeforces required.`,
  },
  {
    n: "02",
    title: "Get seeded",
    body: "Once the bracket fills we seed by Elo and post the matchups in Discord.",
  },
  {
    n: "03",
    title: "Battle",
    body: "Single elimination, best head-to-head races. Cameras on, verdicts from the judge.",
  },
  {
    n: "04",
    title: "Take the pot",
    body: `Last racer standing takes the $${PRIZE_USD} prize pool. Everyone else copes.`,
  },
];

export default async function TournamentPage() {
  const user = await ensureUser();
  const registration = user ? await getRegistration(user.id) : null;
  const registrants = await listPaidRegistrants();
  const count = registrants.length;
  const isFull = count >= TOURNAMENT_CAP;

  const paid = registration?.status === "paid";
  const seed = paid ? registrants.findIndex((r) => r.userId === user!.id) + 1 : 0;

  return (
    <main className="flex-1">
      <div className="shell relative py-8 md:py-12">
        <HeroWord
          word="bracket"
          className="pointer-events-none absolute -left-2 -top-2 -z-10 opacity-20"
        />
        <span
          aria-hidden
          className="hud-meta pointer-events-none absolute top-5 right-6 hidden sm:block md:right-8"
        >
          {"// route :: /tournament"}
        </span>

        {/* Header */}
        <p className="inline-flex items-center gap-2 eyebrow text-muted-foreground">
          <span className="size-2 rounded-full bg-player-self motion-safe:animate-pulse" />
          Season 0 · debut event
        </p>
        <h1 className="mt-2 font-display text-4xl tracking-tight uppercase md:text-6xl">
          The cph2h Tournament
        </h1>
        <p className="mt-3 max-w-2xl text-base leading-7 text-muted-foreground md:text-lg">
          Up to {TOURNAMENT_CAP} racers, one bracket, one champion. A ${ENTRY_USD}{" "}
          buy-in stacks a ${PRIZE_USD} prize pool. Cameras on, verdicts from the
          judge, Elo on the line — the same cph2h, now with a trophy at the end.
        </p>

        {/* Stat plates */}
        <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatPlate label="Field" value={`${TOURNAMENT_CAP}`} sub="players max" />
          <StatPlate label="Entry" value={`$${ENTRY_USD}`} sub="one-time buy-in" />
          <StatPlate label="Prize pool" value={`$${PRIZE_USD}`} sub="winner takes it" />
          <StatPlate
            label="Registered"
            value={`${count}/${TOURNAMENT_CAP}`}
            sub={isFull ? "bracket full" : "spots filling"}
            accent
          />
        </div>

        {/* CTA block */}
        <div className="mt-8 panel bracket-frame flex flex-col gap-4 p-6 md:flex-row md:items-center md:justify-between md:p-8">
          <div>
            <h2 className="font-display text-xl tracking-tight uppercase md:text-2xl">
              {paid ? "You're in" : "Claim your seat"}
            </h2>
            <p className="mt-1 max-w-md text-sm leading-6 text-muted-foreground">
              {paid
                ? "Your entry is confirmed. Watch Discord for the bracket and your first matchup."
                : "You need a cph2h account with a linked Codeforces handle to enter."}
            </p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-stretch">
            {paid ? (
              <span className="inline-flex items-center gap-2 stat-plate px-4 py-3 font-display uppercase tracking-tight text-player-self">
                <CheckCircle2 className="size-5" aria-hidden />
                Seed #{seed}
              </span>
            ) : !user ? (
              <>
                <SlabButton
                  tone="self"
                  size="lg"
                  render={<Link href="/sign-up" />}
                  nativeButton={false}
                >
                  <UserPlus className="size-5" aria-hidden />
                  Sign up to enter
                </SlabButton>
                <SlabButton
                  tone="neutral"
                  size="lg"
                  render={<Link href="/sign-in" />}
                  nativeButton={false}
                >
                  <LogIn className="size-5" aria-hidden />
                  Sign in
                </SlabButton>
              </>
            ) : !user.cfHandle ? (
              <SlabButton
                tone="self"
                size="lg"
                render={<Link href="/settings/cf" />}
                nativeButton={false}
              >
                <Link2 className="size-5" aria-hidden />
                Link Codeforces to enter
              </SlabButton>
            ) : isFull ? (
              <span className="inline-flex items-center gap-2 stat-plate px-4 py-3 font-display uppercase tracking-tight text-muted-foreground">
                Bracket full
              </span>
            ) : (
              <RegisterButton />
            )}

            <SlabButton
              tone="opponent"
              size="lg"
              render={
                <a href={DISCORD_URL} target="_blank" rel="noopener noreferrer" />
              }
              nativeButton={false}
            >
              <MessageCircle className="size-5" aria-hidden />
              Join the Discord
            </SlabButton>
          </div>
        </div>

        {/* Format */}
        <section className="mt-14">
          <h2 className="font-display text-2xl tracking-tight uppercase md:text-3xl">
            How the tournament runs
          </h2>
          <ol className="mt-8 grid gap-8 md:grid-cols-4 md:gap-6">
            {FORMAT.map((step) => (
              <li key={step.n} className="border-l-2 border-player-self/40 pl-4">
                <p className="font-display text-sm tracking-[0.2em] text-player-self tabular-nums">
                  {step.n}
                </p>
                <p className="mt-1 font-display text-lg tracking-tight uppercase">
                  {step.title}
                </p>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {step.body}
                </p>
              </li>
            ))}
          </ol>
        </section>

        {/* Registrants */}
        <section className="mt-14">
          <div className="mb-6 flex items-end justify-between gap-4">
            <div>
              <h2 className="font-display text-2xl tracking-tight uppercase md:text-3xl">
                Registrants
              </h2>
              <p className="text-muted-foreground">
                Everyone who&rsquo;s locked in a seat.
              </p>
            </div>
            <span className="stat-plate px-4 py-2.5 font-mono text-xl font-semibold tabular-nums text-player-self">
              {count}
              <span className="text-muted-foreground">/{TOURNAMENT_CAP}</span>
            </span>
          </div>

          {registrants.length === 0 ? (
            <div className="panel bracket-frame flex flex-col items-center justify-center gap-3 py-14 text-center">
              <Trophy className="size-10 text-player-self" aria-hidden />
              <p className="font-display text-lg tracking-tight uppercase">
                No one&rsquo;s stepped up yet
              </p>
              <p className="max-w-sm text-sm text-muted-foreground">
                Be the first to claim a seat in the bracket.
              </p>
            </div>
          ) : (
            <div className="panel bracket-frame overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[32rem] text-sm">
                  <thead>
                    <tr className="border-b border-border eyebrow text-muted-foreground">
                      <th className="px-4 py-2.5 text-left font-medium">Seed</th>
                      <th className="px-4 py-2.5 text-left font-medium">Player</th>
                      <th className="px-4 py-2.5 text-left font-medium">
                        Codeforces
                      </th>
                      <th className="px-4 py-2.5 text-right font-medium">Rating</th>
                    </tr>
                  </thead>
                  <tbody>
                    {registrants.map((r, i) => {
                      const isMe = user && r.userId === user.id;
                      return (
                        <tr
                          key={r.userId}
                          className={cn(
                            "border-b border-border transition-colors last:border-b-0",
                            isMe
                              ? "border-l-2 border-l-player-self bg-player-self/10"
                              : "hover:bg-muted/50",
                          )}
                        >
                          <td className="px-4 py-3 font-mono text-sm font-semibold tabular-nums">
                            {i + 1}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <span className="font-medium">{r.username}</span>
                              {isMe && (
                                <Badge variant="secondary" className="shrink-0">
                                  You
                                </Badge>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3 font-mono text-xs tabular-nums text-muted-foreground">
                            {r.cfHandle ?? "—"}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-sm tabular-nums text-muted-foreground">
                            {r.cfRating ?? "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function StatPlate({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub: string;
  accent?: boolean;
}) {
  return (
    <div className="stat-plate flex flex-col gap-1 px-4 py-3">
      <span className="eyebrow text-muted-foreground">{label}</span>
      <span
        className={cn(
          "font-mono text-2xl font-semibold tabular-nums",
          accent ? "text-player-self" : "text-foreground",
        )}
      >
        {value}
      </span>
      <span className="font-mono text-[11px] text-muted-foreground">{sub}</span>
    </div>
  );
}
