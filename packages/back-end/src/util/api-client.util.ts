/**
 * Classifies REST API callers by User-Agent so API usage can be broken down by
 * mechanism (CLI, MCP, agent skills, direct HTTP) rather than just counted.
 *
 * First-party clients send `growthbook-<product>/<version>`; everything else
 * falls into a coarse runtime bucket. The raw User-Agent is reported alongside
 * the bucket, so the `unknown`/`other` traffic stays diagnosable.
 */

export type ApiClient =
  /** First-party clients, identified by their `growthbook-*` product token. */
  | "cli"
  | "mcp"
  | "skills"
  | "coderefs"
  /** Our own front-end calling the REST API with a session JWT. */
  | "app"
  /** Generic runtimes and tools — someone's own integration. */
  | "curl"
  | "python"
  | "node"
  | "go"
  | "java"
  | "ruby"
  | "php"
  | "dotnet"
  | "postman"
  | "terraform"
  | "browser"
  /** No User-Agent at all. */
  | "unknown"
  /** A User-Agent we don't recognize. */
  | "other";

export type ApiClientInfo = {
  client: ApiClient;
  clientVersion: string | null;
};

/** `growthbook-cli/2.6.0 (go1.24.0; darwin/arm64)` → cli, 2.6.0 */
// Bounded like the raw User-Agent below — the version is caller-controlled too.
const FIRST_PARTY_RE = /^growthbook-(cli|mcp|skills|coderefs)\/(\S{1,64})/i;

// Order matters: the first match wins, so put specific tools above the generic
// runtimes they are built on (Postman before curl, Terraform before Go).
const GENERIC_CLIENTS: [RegExp, ApiClient][] = [
  [/^postmanruntime\//i, "postman"],
  [/^(hashicorp[- ])?terraform/i, "terraform"],
  [/^curl\//i, "curl"],
  [/^(python-requests|python-urllib|httpx|aiohttp)\//i, "python"],
  [/^(node|undici|axios|got|node-fetch)\b/i, "node"],
  [/^go-http-client\//i, "go"],
  [/^(java|okhttp|apache-httpclient)\//i, "java"],
  [/^(ruby|faraday|rest-client)\b/i, "ruby"],
  [/^(guzzlehttp|php)\//i, "php"],
  [/^(dotnet|\.net)\b/i, "dotnet"],
  [/^mozilla\//i, "browser"],
];

/**
 * Speakeasy-generated CLI releases before the User-Agent override shipped.
 * They identify themselves only by the Go module path in the generator's
 * default User-Agent, with the generator's version rather than the CLI's.
 */
const LEGACY_SPEAKEASY_CLI_RE = /github\.com\/growthbook\/cli\b/i;

export function parseApiClient(userAgent: string | undefined): ApiClientInfo {
  const ua = userAgent?.trim();
  if (!ua) return { client: "unknown", clientVersion: null };

  const firstParty = FIRST_PARTY_RE.exec(ua);
  if (firstParty) {
    return {
      client: firstParty[1].toLowerCase() as ApiClient,
      clientVersion: firstParty[2],
    };
  }

  if (LEGACY_SPEAKEASY_CLI_RE.test(ua)) {
    return { client: "cli", clientVersion: null };
  }

  for (const [re, client] of GENERIC_CLIENTS) {
    if (re.test(ua)) return { client, clientVersion: null };
  }

  return { client: "other", clientVersion: null };
}

/** Bounds the warehouse column; a User-Agent this long is junk or an attack. */
const MAX_USER_AGENT_LENGTH = 256;

export function truncateUserAgent(
  userAgent: string | undefined,
): string | undefined {
  return userAgent?.slice(0, MAX_USER_AGENT_LENGTH) || undefined;
}
