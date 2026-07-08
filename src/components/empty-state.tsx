import type { LucideIcon } from "lucide-react";

interface EmptyStatePageProps {
  /** Shown as an eyebrow path chip, e.g. "/dashboard". */
  path: string;
  icon: LucideIcon;
  title: string;
  description: string;
  /** "What will live here" bullets. */
  items: string[];
}

export function EmptyStatePage({
  path,
  icon: Icon,
  title,
  description,
  items,
}: EmptyStatePageProps) {
  return (
    <main className="shell-narrow relative flex flex-1 flex-col py-16 md:py-24">
      {/* hud-meta edge chrome: a single decorative scatter point. */}
      <span
        aria-hidden
        className="hud-meta absolute top-6 right-6 md:right-8"
      >
        {"// module pending"}
      </span>

      <p>
        <span className="eyebrow inline-flex rounded-sm border border-player-self/40 px-2 py-1 text-player-self">
          cph2h{path}
        </span>
      </p>

      <div className="mt-6 flex items-start gap-4">
        <div className="clip-notch-sm flex size-11 shrink-0 items-center justify-center border border-border bg-muted/40 text-primary">
          <Icon className="size-5" aria-hidden />
        </div>
        <div>
          <h1 className="font-display text-2xl tracking-tight uppercase md:text-3xl">
            {title}
          </h1>
          <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground md:text-base">
            {description}
          </p>
        </div>
      </div>

      <div className="panel bracket-frame mt-10 p-6">
        <p className="font-mono text-[11px] tracking-[0.14em] text-muted-foreground uppercase">
          Coming in a later build
        </p>
        <ul className="mt-4 space-y-2.5 text-sm text-muted-foreground">
          {items.map((item) => (
            <li key={item} className="flex items-start gap-2.5">
              <span
                aria-hidden
                className="mt-2 size-1 shrink-0 rounded-full bg-primary/70"
              />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
