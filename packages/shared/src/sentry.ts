const REDACTED_HEADERS = new Set([
  "authorization",
  "proxy-authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
  "x-vercel-auth",
]);

const REDACTED_URL_PATTERNS = [
  /(\/auth\/reset\/)[^/?#]+/gi,
  /(\/invite\/)[^/?#]+/gi,
  /([?&](?:token|key)=)[^&#]+/gi,
];

const REDACTED = "[Redacted]";

function redactUrl(url: string): string {
  return REDACTED_URL_PATTERNS.reduce(
    (acc, pattern) => acc.replace(pattern, `$1${REDACTED}`),
    url,
  );
}

// Structural subset of Sentry's `Event`, so this works for node, edge, and browser alike
type SentryEventLike = {
  request?: { url?: string; headers?: Record<string, string> };
  transaction?: string;
};

// Strip credentials from a Sentry event. Wire in via `Sentry.init({ beforeSend })`.
export function scrubSentryEvent<T extends SentryEventLike>(event: T): T {
  const headers = event.request?.headers;
  if (headers) {
    Object.keys(headers).forEach((name) => {
      if (REDACTED_HEADERS.has(name.toLowerCase())) {
        headers[name] = REDACTED;
      }
    });
  }

  if (event.request?.url) {
    event.request.url = redactUrl(event.request.url);
  }

  // Without tracing there's no `expressIntegration`, so the transaction name is the raw URL
  if (event.transaction) {
    event.transaction = redactUrl(event.transaction);
  }

  return event;
}
