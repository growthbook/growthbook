import { isIPv6 } from "net";

// Who a keyless upload counts against: an IPv4 address, or an IPv6 /64, which
// is what one subscriber is handed.
export function flagImportSourceKey(address: string | undefined): string {
  if (!address) return "";
  const mapped = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (mapped) return mapped[1];
  if (!isIPv6(address)) return address;

  const [head, tail] = address.split("%")[0].split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const groups =
    tail === undefined
      ? left
      : [
          ...left,
          ...Array<string>(Math.max(0, 8 - left.length - right.length)).fill(
            "0",
          ),
          ...right,
        ];
  const prefix = groups
    .slice(0, 4)
    .map((group) => parseInt(group, 16).toString(16));
  return `${prefix.join(":")}::/64`;
}

// The token from a flag-import path, taken out before the path is logged.
export function redactFlagImportToken(url: string): string {
  return url.replace(/(\/flag-imports\/)[A-Za-z0-9_-]{20,}/, "$1[token]");
}

// A request as the logger has shaped it for its line: the token goes from the
// path and from the route's params.
export function redactFlagImportRequest<
  T extends { url?: unknown; params?: unknown },
>(req: T): T {
  if (typeof req.url !== "string") return req;
  const url = redactFlagImportToken(req.url);
  if (url === req.url) return req;
  req.url = url;
  if (req.params && typeof req.params === "object" && "token" in req.params) {
    req.params = { ...req.params, token: "[token]" };
  }
  return req;
}
