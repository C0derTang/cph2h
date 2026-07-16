/**
 * Pure normalizers for tournament registration profile links (issue #209).
 *
 * Both functions return the canonical `https://` URL string on success, or
 * `null` when the input is not a valid profile URL for that platform. No I/O,
 * no throwing — the API route maps a `null` result to a 400 error code.
 */

const MAX_INPUT_LENGTH = 200;

/** Parse `input` into a URL, prepending `https://` when no scheme is present.
 *  Returns `null` on any parse failure or a non-http(s) scheme. */
function parseHttpUrl(input: string): URL | null {
  const trimmed = input.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_INPUT_LENGTH) return null;

  // A bare `host/path` has no `://`; prepend a scheme so `new URL` can parse
  // it as an absolute URL instead of throwing. Inputs that already specify a
  // (possibly non-http) scheme are left untouched so `javascript:` etc. are
  // rejected below rather than silently coerced.
  const candidate = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  return url;
}

/** Strip query/hash/trailing-slash, force https, and require a non-root
 *  pathname (i.e. an actual profile path, not just the bare host). */
function canonicalize(url: URL): string | null {
  const pathname = url.pathname.replace(/\/+$/, "");
  if (pathname.length === 0) return null;

  return `https://${url.host}${pathname}`;
}

/**
 * Normalize a GitHub profile URL. Accepts `github.com` and `www.github.com`
 * (canonicalized to `github.com`); rejects any other host, including
 * lookalikes like `github.com.evil.com`.
 */
export function normalizeGithubUrl(input: string): string | null {
  const url = parseHttpUrl(input);
  if (!url) return null;

  const host = url.hostname.toLowerCase();
  if (host !== "github.com" && host !== "www.github.com") return null;

  const canonical = canonicalize(url);
  if (!canonical) return null;

  return canonical.replace(/^https:\/\/www\.github\.com/, "https://github.com");
}

/**
 * Normalize a LinkedIn profile URL. Accepts `linkedin.com` (canonicalized to
 * `www.linkedin.com`) and any `*.linkedin.com` subdomain (country variants
 * like `uk.linkedin.com`); rejects lookalikes like `linkedin.com.evil.com`.
 * All paths are valid (`/in/`, `/pub/`, company/school pages, ...) — this
 * only checks the host and that a path is present.
 */
export function normalizeLinkedinUrl(input: string): string | null {
  const url = parseHttpUrl(input);
  if (!url) return null;

  const host = url.hostname.toLowerCase();
  const isBareOrSubdomain =
    host === "linkedin.com" || host.endsWith(".linkedin.com");
  if (!isBareOrSubdomain) return null;

  const canonical = canonicalize(url);
  if (!canonical) return null;

  return canonical.replace(/^https:\/\/linkedin\.com/, "https://www.linkedin.com");
}
