"use client";

/**
 * Race problem pane: renders a scraped Codeforces `ProblemStatement`.
 *
 * The statement HTML arrives already sanitized (server-side, via
 * `sanitize-html` — see `src/lib/cf/statements.ts`) and with math
 * pre-rendered to KaTeX markup. We only need KaTeX's stylesheet here — no
 * KaTeX JS in the client bundle. As defense-in-depth we sanitize once more
 * with plain `dompurify` (the real browser DOM; no jsdom) before injecting
 * via `dangerouslySetInnerHTML`.
 */

import "katex/dist/katex.min.css";

import { useMemo, useState } from "react";
import DOMPurify from "dompurify";
import { Check, Copy } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ProblemStatement, SampleTest } from "@/lib/types";

interface ProblemPaneProps {
  statement: ProblemStatement;
  className?: string;
}

export function ProblemPane({ statement, className }: ProblemPaneProps) {
  const safeHtml = useMemo(
    () =>
      // `svg: true` keeps KaTeX's inline <svg> stretchy glyphs (\sqrt etc.);
      // `svgFilters` stays OFF (KaTeX never emits filters, and that is the
      // risky SVG surface). Mirrors the server-side sanitize in statements.ts.
      DOMPurify.sanitize(statement.html, {
        USE_PROFILES: { html: true, mathMl: true, svg: true },
      }),
    [statement.html],
  );

  return (
    <div className={cn("flex min-h-0 flex-col gap-6 overflow-y-auto", className)}>
      <article
        className="katex-statement text-sm leading-6"
        // Sanitized above with DOMPurify; source is server-sanitized too.
        dangerouslySetInnerHTML={{ __html: safeHtml }}
      />

      {statement.samples.length > 0 && (
        <section className="flex flex-col gap-4">
          <h2 className="font-heading text-sm font-semibold tracking-tight">
            Sample tests
          </h2>
          {statement.samples.map((sample, i) => (
            <SampleBlock key={i} index={i + 1} sample={sample} />
          ))}
        </section>
      )}
    </div>
  );
}

function SampleBlock({ index, sample }: { index: number; sample: SampleTest }) {
  return (
    <div className="grid gap-3 rounded-lg border border-border bg-card/40 p-3 md:grid-cols-2">
      <SampleIo label={`Input ${index}`} value={sample.input} />
      <SampleIo label={`Output ${index}`} value={sample.output} />
    </div>
  );
}

function SampleIo({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard may be unavailable (insecure context / denied permission);
      // fail silently rather than break the pane.
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="eyebrow text-muted-foreground">
          {label}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          onClick={copy}
          aria-label={`Copy ${label.toLowerCase()}`}
        >
          {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <pre className="overflow-x-auto rounded-md border border-border bg-muted/40 p-2.5 font-mono text-xs whitespace-pre">
        {value}
      </pre>
    </div>
  );
}
