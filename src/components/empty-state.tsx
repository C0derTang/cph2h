import type { LucideIcon } from "lucide-react";

interface EmptyStatePageProps {
  /** Shown as a terminal-style breadcrumb, e.g. "/dashboard". */
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
    <main className="shell-narrow flex flex-1 flex-col py-16 md:py-24">
      <p className="font-mono text-xs text-muted-foreground">
        <span className="text-primary">$</span> cd ~/cph2h{path}
      </p>

      <div className="mt-6 flex items-start gap-4">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/40 text-primary">
          <Icon className="size-5" aria-hidden />
        </div>
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight md:text-3xl">
            {title}
          </h1>
          <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground md:text-base">
            {description}
          </p>
        </div>
      </div>

      <div className="mt-10 rounded-xl border border-dashed border-border bg-card/40 p-6">
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
