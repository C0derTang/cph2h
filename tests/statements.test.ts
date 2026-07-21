import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchStatement, parseStatementHtml } from "@/lib/cf/statements";
import { resetLimiterDeps, setLimiterDeps } from "@/lib/cf/limiter";

const fixture = readFileSync(
  path.resolve(__dirname, "fixtures/cf-problem.html"),
  "utf-8",
);

describe("parseStatementHtml", () => {
  const parsed = parseStatementHtml(fixture);

  it("extracts every input/output sample pair", () => {
    expect(parsed.samples).toHaveLength(2);
  });

  it("preserves multiline input line breaks (test-example-line markup)", () => {
    expect(parsed.samples[0].input).toBe("2\n3\n1 2 3\n4\n10 20 30 40");
  });

  it("preserves multiline output line breaks and trims trailing newline", () => {
    expect(parsed.samples[0].output).toBe("3 5 10\n40 90 140 200");
  });

  it("parses a second plain-text sample block", () => {
    expect(parsed.samples[1]).toEqual({
      input: "1\n5\n5 4 3 2 1",
      output: "5 9 12 14 15",
    });
  });

  it("returns a non-empty statement body", () => {
    expect(parsed.html.trim().length).toBeGreaterThan(0);
  });

  it("keeps the statement legend and specifications but drops header/samples", () => {
    expect(parsed.html).toContain("subsequences");
    expect(parsed.html).toContain("Input");
    // Header title and the raw sample <pre> must not leak into the body.
    expect(parsed.html).not.toContain("time limit per test");
    expect(parsed.html).not.toContain("test-example-line");
  });

  it("pre-renders LaTeX to KaTeX markup (no raw $$$ delimiters left)", () => {
    expect(parsed.html).toContain("katex");
    expect(parsed.html).not.toContain("$$$");
  });

  it("keeps KaTeX inline <svg> output (\\sqrt) through sanitization", () => {
    // \sqrt renders as an inline <svg><path/></svg>; the sanitizer must allow
    // svg so stretchy constructs are not silently stripped.
    expect(parsed.html).toContain("<svg");
  });

  it("produces sanitized HTML with no script tags", () => {
    expect(parsed.html.toLowerCase()).not.toContain("<script");
  });

  it("strips <script> tags and inline event handlers (XSS)", () => {
    const { html } = parseStatementHtml(
      '<div class="problem-statement">' +
        '<p>hi<img src="x" onerror="alert(1)"></p>' +
        "<script>alert(2)</script>" +
        "</div>",
    );
    expect(html.toLowerCase()).not.toContain("<script");
    expect(html.toLowerCase()).not.toContain("onerror");
    expect(html.toLowerCase()).not.toContain("alert(2)");
  });
});

describe("fetchStatement slot claiming + retry", () => {
  afterEach(() => {
    resetLimiterDeps();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("claims a global slot before each attempt and retries a 429 honoring Retry-After", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0); // pin jitter to 0 => backoff exactly 5000
    const claim = vi.fn().mockResolvedValue({ slotAtMs: 0, dbNowMs: 0 }); // due now, no sleep
    setLimiterDeps({ claim });

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("<html>rate limited</html>", {
          status: 429,
          headers: { "retry-after": "3" },
        }),
      )
      .mockResolvedValueOnce(new Response(fixture, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const pending = fetchStatement("1A");
    const settled = expect(pending).resolves.toMatchObject({ problemId: "1A" });

    // First attempt (claim + fetch) happens on the first tick.
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(claim).toHaveBeenCalledTimes(1);

    // delay = max(min(3000, 30000), 5000) + 0 = 5000. Not before it elapses.
    await vi.advanceTimersByTimeAsync(4999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // A slot was claimed for the retry attempt too.
    expect(claim).toHaveBeenCalledTimes(2);

    await settled;
  });

  it("gives up after 3 attempts (1 + 2 retries) on persistent 503", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    const claim = vi.fn().mockResolvedValue({ slotAtMs: 0, dbNowMs: 0 });
    setLimiterDeps({ claim });

    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("<html>busy</html>", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);

    const pending = fetchStatement("1A");
    const settled = expect(pending).rejects.toThrow("HTTP 503");

    await vi.advanceTimersByTimeAsync(0); // attempt 1
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5000); // backoff -> attempt 2
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(10000); // backoff -> attempt 3 (last)
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(claim).toHaveBeenCalledTimes(3);

    await settled;
  });

  it("propagates a CfBackpressureError from the claimer as a fetch failure", async () => {
    const { CfBackpressureError } = await import("@/lib/cf/limiter");
    const claim = vi
      .fn()
      .mockResolvedValue({ slotAtMs: 60_000, dbNowMs: 0 }); // > 15s cap => backpressure
    const giveBack = vi.fn().mockResolvedValue(undefined);
    setLimiterDeps({ claim, giveBack });

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchStatement("1A")).rejects.toBeInstanceOf(CfBackpressureError);
    // Never hit the network — the slot was refused first.
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
