import dns from "dns";
import http from "http";
import https from "https";
import net, { BlockList, LookupFunction } from "net";
import type { Duplex } from "stream";
import { WEBHOOK_BLOCK_PRIVATE_NETWORKS } from "./secrets";

// Link-local and cloud metadata endpoints are never a legitimate destination.
const alwaysBlocked = new BlockList();
alwaysBlocked.addSubnet("169.254.0.0", 16, "ipv4");
alwaysBlocked.addAddress("100.100.100.200", "ipv4");
alwaysBlocked.addSubnet("fe80::", 10, "ipv6");
alwaysBlocked.addAddress("fd00:ec2::254", "ipv6");

const privateNetworks = new BlockList();
privateNetworks.addSubnet("0.0.0.0", 8, "ipv4");
privateNetworks.addSubnet("10.0.0.0", 8, "ipv4");
privateNetworks.addSubnet("100.64.0.0", 10, "ipv4");
privateNetworks.addSubnet("127.0.0.0", 8, "ipv4");
privateNetworks.addSubnet("172.16.0.0", 12, "ipv4");
privateNetworks.addSubnet("192.168.0.0", 16, "ipv4");
privateNetworks.addAddress("::", "ipv6");
privateNetworks.addAddress("::1", "ipv6");
privateNetworks.addSubnet("fc00::", 7, "ipv6");

export function isBlockedAddress(
  address: string,
  blockPrivate: boolean = WEBHOOK_BLOCK_PRIVATE_NETWORKS,
) {
  const family = net.isIPv6(address) ? "ipv6" : "ipv4";
  return (
    alwaysBlocked.check(address, family) ||
    (blockPrivate && privateNetworks.check(address, family))
  );
}

function blockedError(address: string) {
  return new Error(`Requests to ${address} are not allowed`);
}

const guardedLookup = ((hostname, options, callback) => {
  dns.lookup(hostname, options, (err, address, family) => {
    if (err) return callback(err, address, family);
    // net requests `all: true` for happy-eyeballs, which returns an array.
    const addresses = Array.isArray(address) ? address : [{ address }];
    const blocked = addresses.find((a) => isBlockedAddress(a.address));
    if (blocked) return callback(blockedError(blocked.address), "", 0);
    callback(null, address, family);
  });
}) as LookupFunction;

type ConnectionCallback = (err: Error | null, socket?: Duplex) => void;
type CreateConnection = (
  options: { host?: string },
  callback: ConnectionCallback,
) => Duplex | undefined;

// net skips `lookup` for IP literals, so those are checked here instead.
function guard<T extends http.Agent>(agent: T): T {
  const target = agent as unknown as { createConnection: CreateConnection };
  const createConnection = target.createConnection.bind(agent);
  target.createConnection = (options, callback) => {
    const host = options.host ?? "";
    if (net.isIP(host) && isBlockedAddress(host)) {
      callback(blockedError(host));
      return undefined;
    }
    return createConnection(options, callback);
  };
  return agent;
}

export const guardedAgents = {
  httpAgent: guard(new http.Agent({ lookup: guardedLookup })),
  httpsAgent: guard(new https.Agent({ lookup: guardedLookup })),
};

export function getGuardedAgent(url: URL) {
  return url.protocol === "http:"
    ? guardedAgents.httpAgent
    : guardedAgents.httpsAgent;
}
