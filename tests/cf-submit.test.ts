import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CfSubmission } from "@/lib/types";

const FIXTURE_DIR = path.resolve(__dirname, "fixtures");
const submitPageHtml = readFileSync(path.join(FIXTURE_DIR, "cf-submit-page.html"), "utf8");
const duplicateHtml = readFileSync(path.join(FIXTURE_DIR, "cf-submit-duplicate.html"), "utf8");
const notLoggedInHtml = readFileSync(path.join(FIXTURE_DIR, "cf-login-page.html"), "utf8");

// Hoisted mocks so `vi.mock` factories can close over them. We keep the real
// auth/client parsing helpers (importActual) and override only the two I/O
// boundaries this module reuses: `ensureSession` (#5) and `getUserStatus` (#3).
const { ensureSessionMock, getUserStatusMock } = vi.hoisted(() => ({
  ensureSessionMock: vi.fn(),
  getUserStatusMock: vi.fn(),
}));

vi.mock("@/lib/cf/auth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/cf/auth")>("@/lib/cf/auth");
  return { ...actual, ensureSession: ensureSessionMock };
});

vi.mock("@/lib/cf/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/cf/client")>("@/lib/cf/client");
  return { ...actual, getUserStatus: getUserStatusMock };
});

function htmlResponse(body: string, status = 200): Response {
  return new Response(body, { status, headers: { "content-type": "text/html" } });
}

function makeSubmission(overrides: Partial<CfSubmission> = {}): CfSubmission {
  return {
    id: 300000001,
    contestId: 1794,
    creationTimeSeconds: 1700000500,
    problem: { contestId: 1794, index: "C", name: "Sum on Subarrays", rating: 1600 },
    author: { members: [{ handle: "tourist" }] },
    programmingLanguage: "GNU G++17 7.3.0",
    verdict: undefined,
    ...overrides,
  };
}

beforeEach(() => {
  ensureSessionMock.mockReset();
  getUserStatusMock.mockReset();
  ensureSessionMock.mockResolvedValue({
    cookieJar: { JSESSIONID: "sess1" },
    csrfToken: "storedcsrf00000000000000000000000",
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("buildSubmitForm", () => {
  it("builds cf-tool's submit field set", async () => {
    const { buildSubmitForm } = await import("@/lib/cf/submit");
    const form = buildSubmitForm({
      csrfToken: "tok123",
      index: "C",
      languageId: 54,
      code: "int main(){}",
      ftaa: "abcdefghij01234567",
    });
    expect(form.get("csrf_token")).toBe("tok123");
    expect(form.get("action")).toBe("submitSolutionFormSubmitted");
    expect(form.get("submittedProblemIndex")).toBe("C");
    expect(form.get("programTypeId")).toBe("54");
    expect(form.get("source")).toBe("int main(){}");
    expect(form.get("tabSize")).toBe("4");
    expect(form.get("sourceFile")).toBe("");
    expect(form.get("ftaa")).toBe("abcdefghij01234567");
    expect(form.get("bfaa")).toBeTruthy();
  });
});

describe("extractSubmitError", () => {
  it("detects the duplicate-code error", async () => {
    const { extractSubmitError } = await import("@/lib/cf/submit");
    const err = extractSubmitError(duplicateHtml);
    expect(err?.code).toBe("duplicate_code");
  });

  it("returns a submit_rejected error for a generic inline error span", async () => {
    const { extractSubmitError } = await import("@/lib/cf/submit");
    const html = `<span class="error for__programTypeId">Choose valid language</span>`;
    const err = extractSubmitError(html);
    expect(err?.code).toBe("submit_rejected");
    expect(err?.message).toBe("Choose valid language");
  });

  it("returns null when the body carries no error (accepted submit)", async () => {
    const { extractSubmitError } = await import("@/lib/cf/submit");
    expect(extractSubmitError("")).toBeNull();
    expect(extractSubmitError("<html><body>redirecting</body></html>")).toBeNull();
  });
});

describe("findLatestSubmissionId", () => {
  it("picks the most recent submission matching the problem", async () => {
    const { findLatestSubmissionId } = await import("@/lib/cf/submit");
    const subs = [
      makeSubmission({ id: 1, creationTimeSeconds: 100 }),
      makeSubmission({ id: 2, creationTimeSeconds: 300 }),
      makeSubmission({ id: 3, creationTimeSeconds: 200 }),
    ];
    expect(findLatestSubmissionId(subs, "1794C", 0)).toBe(2);
  });

  it("ignores submissions to other problems", async () => {
    const { findLatestSubmissionId } = await import("@/lib/cf/submit");
    const subs = [
      makeSubmission({ id: 9, creationTimeSeconds: 999, problem: { contestId: 1794, index: "D", name: "x" } }),
    ];
    expect(findLatestSubmissionId(subs, "1794C", 0)).toBeNull();
  });

  it("breaks equal-timestamp ties by highest id", async () => {
    const { findLatestSubmissionId } = await import("@/lib/cf/submit");
    const subs = [
      makeSubmission({ id: 10, creationTimeSeconds: 500 }),
      makeSubmission({ id: 12, creationTimeSeconds: 500 }),
    ];
    expect(findLatestSubmissionId(subs, "1794C", 0)).toBe(12);
  });

  it("rejects submissions created before the not-before bound (stale readback)", async () => {
    const { findLatestSubmissionId } = await import("@/lib/cf/submit");
    // Only a prior attempt to the same problem is visible; the one we just made
    // has not surfaced in user.status yet.
    const subs = [makeSubmission({ id: 42, creationTimeSeconds: 1000 })];
    expect(findLatestSubmissionId(subs, "1794C", 2000)).toBeNull();
  });
});

describe("submitSolution", () => {
  it("submits, threads cookies, and reads back the submission id", async () => {
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      if ((init?.method ?? "GET") === "GET") return htmlResponse(submitPageHtml);
      return htmlResponse("", 302); // successful submit redirect
    });
    vi.stubGlobal("fetch", fetchMock);
    // Fresh submission surfaced by user.status (after the not-before bound).
    const nowSec = Math.floor(Date.now() / 1000);
    getUserStatusMock.mockResolvedValue([
      makeSubmission({ id: 300000042, creationTimeSeconds: nowSec }),
    ]);

    const { submitSolution } = await import("@/lib/cf/submit");
    const result = await submitSolution({
      userId: "user-1",
      contestId: 1794,
      index: "C",
      code: "int main(){}",
    });

    expect(result.cfSubmissionId).toBe(300000042);
    expect(ensureSessionMock).toHaveBeenCalledWith("user-1");
    expect(getUserStatusMock).toHaveBeenCalledWith("tourist", 1, 10);

    // POST carried the page's refreshed csrf + the submit fields + cookies.
    const postCall = fetchMock.mock.calls.find(
      (c) => (c[1] as RequestInit | undefined)?.method === "POST",
    )!;
    const postInit = postCall[1] as RequestInit;
    const body = String(postInit.body);
    expect(body).toContain("csrf_token=55aa55aa55aa55aa55aa55aa55aa55aa");
    expect(body).toContain("action=submitSolutionFormSubmitted");
    expect(body).toContain("bfaa=");
    expect(body).toContain("ftaa=");
    expect((postInit.headers as Record<string, string>).cookie).toContain("JSESSIONID=sess1");
  });

  it("throws not_logged_in when the submit page has no handle", async () => {
    const fetchMock = vi.fn().mockResolvedValue(htmlResponse(notLoggedInHtml));
    vi.stubGlobal("fetch", fetchMock);

    const { submitSolution, CfSubmitError } = await import("@/lib/cf/submit");
    await expect(
      submitSolution({ userId: "user-1", contestId: 1794, index: "C", code: "x" }),
    ).rejects.toBeInstanceOf(CfSubmitError);
    // No POST is attempted once we detect the session is not signed in.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(getUserStatusMock).not.toHaveBeenCalled();
  });

  it("throws submission_not_found (not a stale id) when only a prior attempt is visible", async () => {
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      if ((init?.method ?? "GET") === "GET") return htmlResponse(submitPageHtml);
      return htmlResponse("", 302); // submit accepted; id just hasn't surfaced
    });
    vi.stubGlobal("fetch", fetchMock);
    // user.status lags: it only shows an earlier submission to the same problem.
    const staleSec = Math.floor(Date.now() / 1000) - 3600;
    getUserStatusMock.mockResolvedValue([
      makeSubmission({ id: 111, creationTimeSeconds: staleSec }),
    ]);

    const { submitSolution } = await import("@/lib/cf/submit");
    await expect(
      submitSolution({ userId: "user-1", contestId: 1794, index: "C", code: "x" }),
    ).rejects.toMatchObject({ code: "submission_not_found" });
  });

  it("throws duplicate_code when CF rejects identical source", async () => {
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      if ((init?.method ?? "GET") === "GET") return htmlResponse(submitPageHtml);
      return htmlResponse(duplicateHtml);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { submitSolution } = await import("@/lib/cf/submit");
    await expect(
      submitSolution({ userId: "user-1", contestId: 1794, index: "C", code: "x" }),
    ).rejects.toMatchObject({ code: "duplicate_code" });
    // A duplicate is caught before any read-back.
    expect(getUserStatusMock).not.toHaveBeenCalled();
  });
});
