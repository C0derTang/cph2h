/**
 * Tests for src/lib/piston.ts (issue #46, replaces tests/judge0.test.ts).
 *
 * `normalizeOutput`/`outputsMatch` are pure and tested directly. `runCode`
 * is tested against mocked `global.fetch` with Piston-shaped responses — no
 * live network calls.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PISTON_STATUS_ACCEPTED,
  PISTON_STATUS_COMPILE_ERROR,
  PISTON_STATUS_RUNTIME_ERROR,
  normalizeOutput,
  outputsMatch,
  runCode,
} from "@/lib/piston";

describe("normalizeOutput / outputsMatch", () => {
  it("strips trailing whitespace and blank lines", () => {
    expect(normalizeOutput("1 2 3 \n4\t\n\n\n")).toBe("1 2 3\n4");
  });

  it("treats identical output as a match", () => {
    expect(outputsMatch("3\n", "3\n")).toBe(true);
  });

  it("ignores trailing blank lines", () => {
    expect(outputsMatch("3\n\n\n", "3\n")).toBe(true);
    expect(outputsMatch("3", "3\n\n")).toBe(true);
  });

  it("ignores trailing whitespace on each line", () => {
    expect(outputsMatch("3 \n4\t\n", "3\n4\n")).toBe(true);
  });

  it("normalizes CRLF line endings", () => {
    expect(outputsMatch("3\r\n4\r\n", "3\n4\n")).toBe(true);
  });

  it("does not ignore meaningful whitespace mid-line", () => {
    expect(outputsMatch("1 2\n", "12\n")).toBe(false);
  });

  it("rejects genuinely different output", () => {
    expect(outputsMatch("3\n", "4\n")).toBe(false);
  });

  it("rejects a differing number of significant lines", () => {
    expect(outputsMatch("1\n2\n", "1\n")).toBe(false);
  });
});

describe("runCode", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function jsonResponse(body: unknown, ok = true, status = 200) {
    return {
      ok,
      status,
      json: () => Promise.resolve(body),
    };
  }

  it("posts to Piston's /execute with the expected shape and returns Accepted on success", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        language: "c++",
        version: "10.2.0",
        run: { stdout: "4\n", stderr: "", output: "4\n", code: 0, signal: null },
      }),
    );

    const result = await runCode({ code: "int main(){}", stdin: "2 2\n" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://emkc.org/api/v2/piston/execute");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string) as {
      language: string;
      version: string;
      files: { content: string }[];
      stdin: string;
    };
    expect(body.language).toBe("c++");
    expect(body.version).toBe("10.2.0");
    expect(body.files).toEqual([{ content: "int main(){}" }]);
    expect(body.stdin).toBe("2 2\n");

    expect(result).toEqual({
      statusId: PISTON_STATUS_ACCEPTED,
      status: "Accepted",
      stdout: "4\n",
      stderr: "",
      compileOutput: null,
      timeSec: null,
    });
  });

  it("maps a non-zero compile.code to a compile-error result", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        language: "c++",
        version: "10.2.0",
        compile: {
          stdout: "",
          stderr: "main.cpp:1:1: error: expected ';'",
          output: "main.cpp:1:1: error: expected ';'",
          code: 1,
          signal: null,
        },
        run: { stdout: "", stderr: "", output: "", code: null, signal: null },
      }),
    );

    const result = await runCode({ code: "int main() {", stdin: "" });

    expect(result.statusId).toBe(PISTON_STATUS_COMPILE_ERROR);
    expect(result.status).toBe("Compilation Error");
    expect(result.compileOutput).toBe("main.cpp:1:1: error: expected ';'");
  });

  it("treats a present compile stage with code 0 as a successful compile", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        language: "c++",
        version: "10.2.0",
        compile: { stdout: "", stderr: "", output: "", code: 0, signal: null },
        run: { stdout: "ok\n", stderr: "", output: "ok\n", code: 0, signal: null },
      }),
    );

    const result = await runCode({ code: "int main(){}", stdin: "" });

    expect(result.statusId).toBe(PISTON_STATUS_ACCEPTED);
    expect(result.stdout).toBe("ok\n");
  });

  it("maps a non-zero run.code (no signal) to a runtime-error result", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        language: "c++",
        version: "10.2.0",
        run: { stdout: "", stderr: "boom", output: "boom", code: 1, signal: null },
      }),
    );

    const result = await runCode({ code: "int main(){ return 1; }", stdin: "" });

    expect(result.statusId).toBe(PISTON_STATUS_RUNTIME_ERROR);
    expect(result.status).toBe("Runtime Error (exit code 1)");
    expect(result.stderr).toBe("boom");
  });

  it("maps a run signal (e.g. segfault) to a runtime-error result", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        language: "c++",
        version: "10.2.0",
        run: { stdout: "", stderr: "", output: "", code: null, signal: "SIGSEGV" },
      }),
    );

    const result = await runCode({ code: "int main(){ int*p=0; *p=1; }", stdin: "" });

    expect(result.statusId).toBe(PISTON_STATUS_RUNTIME_ERROR);
    expect(result.status).toBe("Runtime Error (SIGSEGV)");
  });

  it("returns an accepted result with wrong output when logic is wrong (route decides pass/fail)", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        language: "c++",
        version: "10.2.0",
        run: { stdout: "5\n", stderr: "", output: "5\n", code: 0, signal: null },
      }),
    );

    const result = await runCode({ code: "int main(){}", stdin: "2 2\n" });

    expect(result.statusId).toBe(PISTON_STATUS_ACCEPTED);
    expect(outputsMatch(result.stdout, "4\n")).toBe(false);
  });

  it("respects the PISTON_URL env override", async () => {
    vi.stubEnv("PISTON_URL", "https://self-hosted.example.com/api/v2");
    vi.resetModules();
    const { runCode: runCodeWithOverride } = await import("@/lib/piston");

    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        language: "c++",
        version: "10.2.0",
        run: { stdout: "", stderr: "", output: "", code: 0, signal: null },
      }),
    );

    await runCodeWithOverride({ code: "int main(){}", stdin: "" });

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe("https://self-hosted.example.com/api/v2/execute");
  });

  it("throws with the HTTP status on a non-2xx response", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}, false, 503));

    await expect(runCode({ code: "int main(){}", stdin: "" })).rejects.toThrow(
      "Piston request failed: HTTP 503",
    );
  });
});
