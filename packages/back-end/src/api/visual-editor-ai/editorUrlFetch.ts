import { cancellableFetch } from "back-end/src/util/http.util";

const MAX_HTML_BYTES = 2_000_000;
// One budget for the whole operation, redirects included — not per hop.
const FETCH_TIMEOUT_MS = 8_000;
const MAX_REDIRECTS = 3;
const HTML_CONTENT_TYPE = /^\s*(text\/html|application\/xhtml\+xml)/i;

/**
 * Accept only a concrete http(s) page URL. Not an SSRF control — egress
 * filtering is Smokescreen's job (WEBHOOK_PROXY on Cloud). A hostname
 * blocklist here is bypassable (decimal IPs, DNS rebinding) and would break
 * self-hosted installs editing intranet apps, which have no proxy.
 *
 * ponytail: close private-address rejection once inside cancellableFetch
 * (resolve, reject RFC1918, pin the IP), not with a blocklist in one caller.
 */
export const parseFetchableEditorUrl = (raw: string): URL | null => {
  if (!raw || raw.includes("*")) return null;

  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username || url.password) return null;

  return url;
};

const fetchOnce = (url: URL, maxTimeMs: number) =>
  cancellableFetch(
    url.href,
    {
      method: "GET",
      redirect: "manual",
      headers: { Accept: "text/html,application/xhtml+xml" },
    },
    {
      maxContentSize: MAX_HTML_BYTES,
      maxTimeMs,
      throwOnTruncate: true,
    },
  );

// Ignore scheme upgrade, optional www., and a trailing slash — those never
// change the document. Anything else (path, query, host) is a different page.
const pageIdentity = (u: URL): string =>
  `${u.host.replace(/^www\./, "")}${u.pathname.replace(/\/+$/, "")}${u.search}`;

// Follow same-page canonicalization only. Login, locale, cross-host, and
// https→http are different documents (or a downgrade) and return null.
export const fetchPageHtml = async (
  start: URL,
): Promise<{ url: URL; html: string } | null> => {
  let url = start;
  const deadline = Date.now() + FETCH_TIMEOUT_MS;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return null;

    const { responseWithoutBody: res, stringBody } = await fetchOnce(
      url,
      remaining,
    );

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) return null;

      let next: URL;
      try {
        next = new URL(location, url);
      } catch {
        return null;
      }
      if (next.protocol !== "http:" && next.protocol !== "https:") return null;
      if (url.protocol === "https:" && next.protocol === "http:") return null;
      if (next.username || next.password) return null;
      if (pageIdentity(next) !== pageIdentity(url)) return null;

      url = next;
      continue;
    }

    if (res.status !== 200) return null;
    if (!HTML_CONTENT_TYPE.test(res.headers.get("content-type") ?? "")) {
      return null;
    }
    return { url, html: stringBody };
  }

  return null;
};
