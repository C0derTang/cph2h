/**
 * Codeforces problem-statement scraper.
 *
 * The CF public API exposes problem metadata but *not* statement bodies or
 * sample tests, so those have to be scraped from the rendered problem page.
 * This module:
 *  - parses that HTML with cheerio (`parseStatementHtml`, a pure function that
 *    is unit-tested against a saved fixture),
 *  - fetches the page over HTTP (`fetchStatement`), and
 *  - caches the result in `problem_statements` so each problem is scraped at
 *    most once (`getOrScrapeStatement`).
 *
 * ## Math-rendering approach: server-side pre-render with KaTeX
 *
 * Codeforces delimits LaTeX in the statement body with `$$$…$$$` (inline) and,
 * less commonly, `$$…$$` / `$$$$$$…$$$$$$` (display). Rather than shipping the
 * KaTeX *JavaScript* to every client and rendering in the browser, we render
 * the math to static HTML *here on the server* inside `parseStatementHtml`,
 * then sanitize the result. Consequences:
 *  - The cached/returned `ProblemStatement.html` already contains the final
 *    KaTeX markup, so `ProblemPane` only needs the KaTeX *stylesheet* — no
 *    KaTeX JS in the client bundle, no render flash.
 *  - Parsing + rendering is deterministic and fully covered by the fixture
 *    unit test.
 * The HTML is sanitized with DOMPurify (isomorphic, so it also runs in the
 * client component as defense-in-depth) before it is ever stored or injected.
 */

import * as cheerio from "cheerio";
import type { CheerioAPI } from "cheerio";
import katex from "katex";
import DOMPurify from "isomorphic-dompurify";
import { eq } from "drizzle-orm";

import type { ProblemId, ProblemStatement, SampleTest } from "@/lib/types";
import { problemUrl } from "@/lib/types";

// ---------------------------------------------------------------------------
// HTML-entity decoding (for LaTeX pulled back out of the HTML source)
// ---------------------------------------------------------------------------

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

/**
 * Decode the handful of HTML entities cheerio re-encodes when it serializes a
 * node back to a string. KaTeX needs raw LaTeX (`a < b`, not `a &lt; b`).
 */
function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code: string) =>
      String.fromCodePoint(parseInt(code, 16)),
    )
    .replace(/&([a-zA-Z]+);/g, (match, name: string) => NAMED_ENTITIES[name] ?? match);
}

function renderTex(tex: string, displayMode: boolean): string {
  return katex.renderToString(decodeEntities(tex), {
    displayMode,
    throwOnError: false,
    strict: false,
  });
}

/**
 * Replace CF's LaTeX delimiters in a statement HTML fragment with rendered
 * KaTeX markup. Longer delimiters are handled first so their inner `$` runs
 * are not mistaken for shorter ones.
 */
function renderMath(html: string): string {
  return html
    .replace(/\$\$\$\$\$\$([\s\S]+?)\$\$\$\$\$\$/g, (_, tex: string) =>
      renderTex(tex, true),
    )
    .replace(/\$\$\$([\s\S]+?)\$\$\$/g, (_, tex: string) => renderTex(tex, false))
    .replace(/\$\$([\s\S]+?)\$\$/g, (_, tex: string) => renderTex(tex, true));
}

// ---------------------------------------------------------------------------
// Sample-test extraction
// ---------------------------------------------------------------------------

/**
 * Extract the text of every `<pre>` matching `selector`, preserving line
 * breaks. Modern CF wraps each line in a `div.test-example-line`; older markup
 * uses `<br>`.
 */
function preTexts($: CheerioAPI, selector: string): string[] {
  return $(selector)
    .map((_, pre) => {
      const $pre = $(pre);
      const lineDivs = $pre.find("div.test-example-line");
      if (lineDivs.length > 0) {
        return lineDivs
          .map((__, el) => $(el).text())
          .get()
          .join("\n")
          .replace(/\s+$/, "");
      }
      const withBreaks = ($pre.html() ?? "").replace(/<br\s*\/?>/gi, "\n");
      return cheerio
        .load(`<pre>${withBreaks}</pre>`)("pre")
        .text()
        .replace(/\s+$/, "");
    })
    .get();
}

function extractSamples($: CheerioAPI): SampleTest[] {
  const inputs = preTexts($, ".sample-test .input pre");
  const outputs = preTexts($, ".sample-test .output pre");
  const count = Math.min(inputs.length, outputs.length);
  const samples: SampleTest[] = [];
  for (let i = 0; i < count; i++) {
    samples.push({ input: inputs[i], output: outputs[i] });
  }
  return samples;
}

// ---------------------------------------------------------------------------
// Pure parser (unit-tested against tests/fixtures/cf-problem.html)
// ---------------------------------------------------------------------------

/**
 * Pure transform: raw problem-page HTML -> `{ html, samples }` (minus
 * `problemId`, which the caller supplies). Renders math server-side and
 * sanitizes the statement body. No network, no DB — safe to unit-test.
 */
export function parseStatementHtml(html: string): Omit<ProblemStatement, "problemId"> {
  const $ = cheerio.load(html);
  const samples = extractSamples($);

  const $statement = $(".problem-statement").first();
  // The header (title + time/memory limits) and the sample tests are rendered
  // separately by the UI, so strip them from the statement body.
  $statement.find(".header").remove();
  $statement.find(".sample-tests").remove();

  const rawBody = $statement.html() ?? "";
  const rendered = renderMath(rawBody);
  // `svg: true` is required: KaTeX renders stretchy constructs (\sqrt,
  // \overbrace, \widehat, ...) as inline <svg><path/></svg>, which the html /
  // mathMl profiles alone would strip. `svgFilters` stays OFF — that surface
  // (feImage/filter) is where DOMPurify's SVG XSS history concentrates and
  // KaTeX never emits it.
  const clean = DOMPurify.sanitize(rendered, {
    USE_PROFILES: { html: true, mathMl: true, svg: true },
  });

  return { html: clean, samples };
}

// ---------------------------------------------------------------------------
// Fetch + cache
// ---------------------------------------------------------------------------

/** Browser-like UA — CF serves a challenge page to obviously-scripted clients. */
const SCRAPE_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml",
};

function urlForProblem(problemId: ProblemId): string {
  const match = /^(\d+)([A-Za-z].*)$/.exec(problemId);
  if (!match) {
    throw new Error(`Invalid problemId: ${problemId}`);
  }
  return problemUrl({ contestId: Number(match[1]), index: match[2] });
}

/**
 * Fetch and parse a problem's statement from codeforces.com. One HTTP request;
 * callers should prefer `getOrScrapeStatement` to avoid re-scraping.
 */
export async function fetchStatement(problemId: ProblemId): Promise<ProblemStatement> {
  const response = await fetch(urlForProblem(problemId), { headers: SCRAPE_HEADERS });
  if (!response.ok) {
    throw new Error(`Failed to fetch statement for ${problemId}: HTTP ${response.status}`);
  }
  const html = await response.text();
  const parsed = parseStatementHtml(html);
  // Fail loud on a half-scraped page: either an empty body or missing samples
  // means the fetch is unusable, so never persist/return a partial statement.
  if (parsed.samples.length === 0 || parsed.html.trim() === "") {
    throw new Error(`No problem statement found for ${problemId}`);
  }
  return { problemId, ...parsed };
}

/**
 * Return the cached statement row for `problemId`, or scrape it, persist it to
 * `problem_statements`, and return it. Guarantees at most one scrape per
 * problem (rate-limit friendly).
 */
export async function getOrScrapeStatement(problemId: ProblemId): Promise<ProblemStatement> {
  // Imported lazily so the pure `parseStatementHtml` can be used (and unit
  // tested) without a live `DATABASE_URL`.
  const { db } = await import("@/lib/db");
  const { problemStatements } = await import("@/lib/db/schema");

  const cached = await db
    .select()
    .from(problemStatements)
    .where(eq(problemStatements.problemId, problemId))
    .limit(1);

  if (cached.length > 0) {
    const row = cached[0];
    return { problemId: row.problemId, html: row.html, samples: row.samples };
  }

  const statement = await fetchStatement(problemId);
  await db
    .insert(problemStatements)
    .values({
      problemId: statement.problemId,
      html: statement.html,
      samples: statement.samples,
      scrapedAt: new Date(),
    })
    .onConflictDoNothing();

  return statement;
}
