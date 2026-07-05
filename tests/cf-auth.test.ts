import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const FIXTURE_DIR = path.resolve(__dirname, "fixtures");
const loginPageHtml = readFileSync(path.join(FIXTURE_DIR, "cf-login-page.html"), "utf8");
const loginErrorHtml = readFileSync(path.join(FIXTURE_DIR, "cf-login-error.html"), "utf8");
const loggedInHtml = readFileSync(path.join(FIXTURE_DIR, "cf-logged-in.html"), "utf8");

// Re-import fresh each test so nothing bleeds across cases.
async function importAuth() {
  return await import("@/lib/cf/auth");
}

function htmlResponse(body: string, setCookie: string[] = []): Response {
  const headers = new Headers({ "content-type": "text/html" });
  for (const cookie of setCookie) headers.append("set-cookie", cookie);
  return new Response(body, { status: 200, headers });
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("extractCsrfToken", () => {
  it("reads the hidden csrf_token input", async () => {
    const { extractCsrfToken } = await importAuth();
    expect(extractCsrfToken(loginPageHtml)).toBe("a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6");
  });

  it("falls back to the X-Csrf-Token meta tag", async () => {
    const { extractCsrfToken } = await importAuth();
    const metaOnly = `<meta name="X-Csrf-Token" content="feedfacefeedfacefeedfacefeedface" />`;
    expect(extractCsrfToken(metaOnly)).toBe("feedfacefeedfacefeedfacefeedface");
  });

  it("returns null when no token is present", async () => {
    const { extractCsrfToken } = await importAuth();
    expect(extractCsrfToken("<html><body>nothing here</body></html>")).toBeNull();
  });
});

describe("extractLoggedInHandle", () => {
  it("reads the handle assignment from a logged-in page", async () => {
    const { extractLoggedInHandle } = await importAuth();
    expect(extractLoggedInHandle(loggedInHtml)).toBe("Tourist");
  });

  it("returns null on the anonymous sign-in page", async () => {
    const { extractLoggedInHandle } = await importAuth();
    expect(extractLoggedInHandle(loginPageHtml)).toBeNull();
  });
});

describe("hasInvalidCredentialsError", () => {
  it("detects the rejection notice", async () => {
    const { hasInvalidCredentialsError } = await importAuth();
    expect(hasInvalidCredentialsError(loginErrorHtml)).toBe(true);
  });

  it("is false on a clean login page", async () => {
    const { hasInvalidCredentialsError } = await importAuth();
    expect(hasInvalidCredentialsError(loginPageHtml)).toBe(false);
  });
});

describe("cookie jar helpers", () => {
  it("merges Set-Cookie headers into the jar", async () => {
    const { mergeSetCookies } = await importAuth();
    const jar = {};
    mergeSetCookies(
      jar,
      htmlResponse("", [
        "JSESSIONID=abc123; Path=/; HttpOnly",
        "39ce7=xyz; Path=/",
      ]),
    );
    expect(jar).toEqual({ JSESSIONID: "abc123", "39ce7": "xyz" });
  });

  it("serializes and re-parses a jar round-trip", async () => {
    const { serializeCookies, parseCookieJar } = await importAuth();
    const jar = { JSESSIONID: "abc123", "39ce7": "xyz" };
    expect(serializeCookies(jar)).toBe("JSESSIONID=abc123; 39ce7=xyz");
    expect(parseCookieJar({ JSESSIONID: "abc123", "39ce7": "xyz" })).toEqual(jar);
  });

  it("parseCookieJar tolerates non-object input", async () => {
    const { parseCookieJar } = await importAuth();
    expect(parseCookieJar(null)).toEqual({});
    expect(parseCookieJar("nope")).toEqual({});
    expect(parseCookieJar(["a"])).toEqual({});
  });
});

describe("cookie jar encryption", () => {
  const validKey = "0".repeat(64);

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("round-trips a jar through encryptCookieJar/decryptCookieJar", async () => {
    vi.stubEnv("CF_CRED_KEY", validKey);
    const { encryptCookieJar, decryptCookieJar } = await importAuth();
    const jar = { JSESSIONID: "sess1", "39ce7": "xyz" };

    const encrypted = encryptCookieJar(jar);
    expect(encrypted).toHaveProperty("ciphertext");
    expect(encrypted).toHaveProperty("iv");
    expect(encrypted).toHaveProperty("authTag");
    // The stored blob never contains the raw cookie values in the clear.
    expect(JSON.stringify(encrypted)).not.toContain("sess1");

    expect(decryptCookieJar(encrypted)).toEqual(jar);
  });

  it("produces a different ciphertext for the same jar on each call (random IV)", async () => {
    vi.stubEnv("CF_CRED_KEY", validKey);
    const { encryptCookieJar } = await importAuth();
    const jar = { JSESSIONID: "sess1" };

    const first = encryptCookieJar(jar);
    const second = encryptCookieJar(jar);

    expect(first.ciphertext).not.toBe(second.ciphertext);
  });

  it("throws missing_key when CF_CRED_KEY is not configured", async () => {
    vi.stubEnv("CF_CRED_KEY", "");
    const { encryptCookieJar, CfAuthError } = await importAuth();

    expect(() => encryptCookieJar({ a: "b" })).toThrow(CfAuthError);
  });

  it("tolerates a legacy plaintext jar as a minimal backward-compat fallback", async () => {
    vi.stubEnv("CF_CRED_KEY", validKey);
    const { decryptCookieJar } = await importAuth();
    const legacyPlaintextJar = { JSESSIONID: "sess1" };

    expect(decryptCookieJar(legacyPlaintextJar)).toEqual(legacyPlaintextJar);
  });
});

describe("generateFtaa", () => {
  it("produces an 18-char lowercase alphanumeric string", async () => {
    const { generateFtaa } = await importAuth();
    const ftaa = generateFtaa();
    expect(ftaa).toMatch(/^[a-z0-9]{18}$/);
  });
});

describe("loginToCf", () => {
  it("logs in, threads cookies, and returns the confirmed handle + csrf", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      const target = String(url);
      const method = init?.method ?? "GET";
      if (target.includes("/enter") && method === "GET") {
        return htmlResponse(loginPageHtml, ["JSESSIONID=sess1; Path=/; HttpOnly"]);
      }
      if (target.includes("/enter") && method === "POST") {
        // Success: CF redirects with an empty body; we model the merged cookie.
        return htmlResponse("", ["JSESSIONID=sess2; Path=/; HttpOnly"]);
      }
      // Confirmation GET of the home page.
      return htmlResponse(loggedInHtml);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { loginToCf } = await importAuth();
    const result = await loginToCf("tourist", "hunter2");

    expect(result.handle).toBe("Tourist");
    expect(result.csrfToken).toBe("99887766554433221100aabbccddeeff");
    expect(result.cookieJar).toEqual({ JSESSIONID: "sess2" });

    // GET enter, POST enter, GET home.
    expect(fetchMock).toHaveBeenCalledTimes(3);

    // The POST must carry the csrf from the login page + the initial cookie.
    const postCall = fetchMock.mock.calls.find(
      (c) => (c[1] as RequestInit | undefined)?.method === "POST",
    )!;
    const postInit = postCall[1] as RequestInit;
    const body = String(postInit.body);
    expect(body).toContain("csrf_token=a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6");
    expect(body).toContain("action=enter");
    expect(body).toContain("remember=on");
    expect(body).toContain("bfaa=");
    expect(body).toContain("ftaa=");
    expect((postInit.headers as Record<string, string>).cookie).toContain(
      "JSESSIONID=sess1",
    );
  });

  it("throws invalid_credentials when CF rejects the login", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (method === "GET") return htmlResponse(loginPageHtml, ["JSESSIONID=sess1; Path=/"]);
      return htmlResponse(loginErrorHtml);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { loginToCf, CfAuthError } = await importAuth();

    await expect(loginToCf("tourist", "wrong")).rejects.toBeInstanceOf(CfAuthError);
    await expect(loginToCf("tourist", "wrong")).rejects.toMatchObject({
      code: "invalid_credentials",
    });
    // GET + POST only; no confirmation fetch after a rejection.
    expect(fetchMock).toHaveBeenCalledTimes(4); // two full attempts above
  });

  it("throws login_page_unavailable when no csrf token can be parsed", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(htmlResponse("<html><body>maintenance</body></html>"));
    vi.stubGlobal("fetch", fetchMock);

    const { loginToCf } = await importAuth();
    await expect(loginToCf("tourist", "hunter2")).rejects.toMatchObject({
      code: "login_page_unavailable",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("throws session_unconfirmed when the home page shows no handle", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      const target = String(url);
      const method = init?.method ?? "GET";
      if (target.includes("/enter") && method === "GET") {
        return htmlResponse(loginPageHtml, ["JSESSIONID=sess1; Path=/"]);
      }
      if (target.includes("/enter") && method === "POST") return htmlResponse("");
      // Home page comes back anonymous (no `handle = "..."`).
      return htmlResponse("<html><body>Please sign in</body></html>");
    });
    vi.stubGlobal("fetch", fetchMock);

    const { loginToCf } = await importAuth();
    await expect(loginToCf("tourist", "hunter2")).rejects.toMatchObject({
      code: "session_unconfirmed",
    });
  });
});
