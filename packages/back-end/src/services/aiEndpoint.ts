import { BlockList, isIP, type LookupFunction } from "node:net";
import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { Agent, ProxyAgent, fetch as undiciFetch } from "undici";
import { IS_CLOUD, WEBHOOK_PROXY } from "back-end/src/util/secrets";
import { trimTrailingSlashes } from "back-end/src/util/http.util";

// Addresses a customer-supplied endpoint must never reach from Cloud.
const nonPublicRanges = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  nonPublicRanges.addSubnet(net, prefix, "ipv4");
}
for (const [net, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["64:ff9b::", 96],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  nonPublicRanges.addSubnet(net, prefix, "ipv6");
}

export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (!family) return false;
  return !nonPublicRanges.check(address, family === 6 ? "ipv6" : "ipv4");
}

function stripBrackets(hostname: string): string {
  return hostname.startsWith("[") ? hostname.slice(1, -1) : hostname;
}

export function normalizeAIBaseUrl(
  raw: string,
  { cloud = IS_CLOUD }: { cloud?: boolean } = {},
):
  | { baseUrl: string; error?: undefined }
  | { baseUrl?: undefined; error: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { baseUrl: "" };

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return {
      error: "Enter a full URL, such as https://ai-gateway.example.com/v1.",
    };
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { error: "The base URL must start with https:// or http://." };
  }
  if (url.username || url.password) {
    return {
      error:
        "Don't put credentials in the base URL. Use the API key field instead.",
    };
  }
  if (url.search || url.hash) {
    return { error: "The base URL can't include a query string or fragment." };
  }

  if (cloud) {
    if (url.protocol !== "https:") {
      return { error: "The base URL must start with https://." };
    }
    const host = stripBrackets(url.hostname);
    if (isIP(host) ? !isPublicAddress(host) : !host.includes(".")) {
      return { error: "The base URL must point to a publicly reachable host." };
    }
  }

  return { baseUrl: trimTrailingSlashes(url.toString()) };
}

export class NonPublicAIEndpointError extends Error {
  code = "EAI_NONPUBLIC";
}

// undici wraps connect errors in a generic "fetch failed", so walk the causes.
export function isNonPublicAIEndpointError(err: unknown): boolean {
  for (let e = err, depth = 0; e && depth < 5; depth++) {
    if (e instanceof NonPublicAIEndpointError) return true;
    e = e instanceof Error ? (e as { cause?: unknown }).cause : undefined;
  }
  return false;
}

// Resolve normally, then refuse to connect if any answer is a non-public
// address. Checking at connect time also covers DNS rebinding.
export const publicOnlyLookup: LookupFunction = (
  hostname,
  options,
  callback,
) => {
  dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, "", 0);
    const list = addresses as LookupAddress[];
    const blocked = list.find((a) => !isPublicAddress(a.address));
    if (blocked || !list.length) {
      return callback(
        new NonPublicAIEndpointError(
          `Refusing to connect to non-public address for ${hostname}`,
        ),
        "",
        0,
      );
    }
    if (options.all) return callback(null, list);
    callback(null, list[0].address, list[0].family);
  });
};

let guardedDispatcher: Agent | ProxyAgent | null = null;
function getGuardedDispatcher() {
  if (!guardedDispatcher) {
    guardedDispatcher = WEBHOOK_PROXY
      ? new ProxyAgent(WEBHOOK_PROXY)
      : new Agent({ connect: { lookup: publicOnlyLookup } });
  }
  return guardedDispatcher;
}

// fetch for customer-supplied endpoints on Cloud. Literal IPs skip DNS, so they
// are checked here; redirects are refused so they can't hop to another host.
export const guardedAIFetch: typeof globalThis.fetch = async (input, init) => {
  const url = new URL(
    typeof input === "string" || input instanceof URL ? input : input.url,
  );
  const host = stripBrackets(url.hostname);
  if (url.protocol !== "https:" || (isIP(host) && !isPublicAddress(host))) {
    throw new NonPublicAIEndpointError(
      "AI endpoints must use https and a public address.",
    );
  }
  const res = await undiciFetch(url, {
    ...(init as Parameters<typeof undiciFetch>[1]),
    redirect: "error",
    dispatcher: getGuardedDispatcher(),
  });
  return res as unknown as Response;
};

export function getAIEndpointFetch(
  baseUrl: string,
): typeof globalThis.fetch | undefined {
  return baseUrl && IS_CLOUD ? guardedAIFetch : undefined;
}

// Options shared by every AI SDK provider factory.
export function getAIClientOptions(
  apiKey: string,
  baseUrl: string,
): { apiKey: string; baseURL?: string; fetch?: typeof globalThis.fetch } {
  if (!baseUrl) return { apiKey };
  return { apiKey, baseURL: baseUrl, fetch: getAIEndpointFetch(baseUrl) };
}
