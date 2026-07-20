/**
 * Pure normalizers for tournament registration fields (issues #209, #239).
 *
 * All functions return a normalized value on success, or `null` when the
 * input is invalid. No I/O, no throwing — the API route maps a `null` result
 * to a 400 error code.
 */

const MAX_INPUT_LENGTH = 200;

/** Max length for name fields (issue #239). */
const MAX_NAME_LENGTH = 100;

/** Max length for an email address per RFC 5321 (issue #239). */
const MAX_EMAIL_LENGTH = 254;

/** `local@domain`, requiring at least a 2-char TLD-like segment after the
 *  last dot; no whitespace or `@` inside either part. Intentionally loose —
 *  this is a format sanity check, not full RFC 5322 validation. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Any C0 control char (0x00-0x1F) or DEL (0x7F), including newlines/tabs. */
const CONTROL_CHAR_RE = /[\u0000-\u001f\u007f]/;

/**
 * Normalize a person's name (first or last). Trims whitespace, rejects empty
 * or over-length input (1..100 chars) and control characters (including
 * newlines) anywhere in the string.
 */
export function normalizeName(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_NAME_LENGTH) return null;
  if (CONTROL_CHAR_RE.test(trimmed)) return null;
  return trimmed;
}

/**
 * Normalize an email address. Trims whitespace, rejects over-length input
 * (>254 chars) and anything not matching the basic `local@domain.tld` shape.
 * Only the domain part is lowercased — the local part is case-sensitive per
 * spec, even though most providers treat it case-insensitively in practice.
 */
export function normalizeEmail(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_EMAIL_LENGTH) return null;
  if (!EMAIL_RE.test(trimmed)) return null;

  const atIndex = trimmed.lastIndexOf("@");
  const local = trimmed.slice(0, atIndex);
  const domain = trimmed.slice(atIndex + 1);
  return `${local}@${domain.toLowerCase()}`;
}

/**
 * Normalize a free-text location. Trims whitespace, rejects empty or
 * over-length input (1..200 chars) and control characters.
 */
export function normalizeLocation(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_INPUT_LENGTH) return null;
  if (CONTROL_CHAR_RE.test(trimmed)) return null;
  return trimmed;
}

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
