import { once } from "events";
import type { Server } from "http";
import type { AddressInfo } from "net";
import bodyParser from "body-parser";
import express, { type Request } from "express";
import app from "back-end/src/app";
import { init } from "back-end/src/init";
import type { ApiCall } from "back-end/test/evals/harness/record";

export interface EvalServer {
  // Base URL, e.g. http://127.0.0.1:53121.
  url: string;
  // Every request made with this key, in the order it arrived.
  callsFor(apiKey: string): ApiCall[];
  close(): Promise<void>;
}

// The key the app's auth middleware would read from this request.
function apiKeyOf(req: Request): string | null {
  const [scheme, value] = (req.headers.authorization ?? "").split(" ");
  if (!value) return null;
  if (scheme === "Bearer") return value.trim();
  if (scheme === "Basic") {
    return Buffer.from(value.trim(), "base64").toString("ascii").split(":")[0];
  }
  return null;
}

const hasBody = (req: Request) =>
  req.headers["transfer-encoding"] !== undefined ||
  Number(req.headers["content-length"] ?? 0) > 0;

// The real app on an ephemeral localhost port. Unlike setupApp, API-key auth
// is the real middleware, so agents authenticate the way customers' agents do.
export async function startEvalServer(): Promise<EvalServer> {
  // The app would run this on its first request; here a failure stops the run
  // instead of a trial.
  await init();

  const requests = new Map<string, { call: ApiCall | null }[]>();
  const outer = express();
  // Parsed before the app's handlers replace req.body with their validated
  // copy, so the record holds what the agent sent. The app's own parsers skip
  // a body that's already parsed.
  outer.use(bodyParser.json({ limit: "10mb" }));
  outer.use(bodyParser.urlencoded({ limit: "2mb", extended: true }));
  outer.use((req, res, next) => {
    const apiKey = apiKeyOf(req);
    if (apiKey) {
      // Held in arrival order and filled in once the response is sent.
      const slot: { call: ApiCall | null } = { call: null };
      const forKey = requests.get(apiKey) ?? [];
      forKey.push(slot);
      requests.set(apiKey, forKey);
      const url = new URL(req.originalUrl, "http://eval");
      const query = Object.fromEntries(url.searchParams);
      const body: unknown = hasBody(req) ? structuredClone(req.body) : null;
      res.on("finish", () => {
        slot.call = {
          method: req.method,
          path: url.pathname,
          ...(Object.keys(query).length ? { query } : {}),
          ...(body !== null ? { body } : {}),
          status: res.statusCode,
        };
      });
    }
    next();
  });
  outer.use(app);

  const server: Server = outer.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    callsFor: (apiKey) =>
      (requests.get(apiKey) ?? []).flatMap((r) => (r.call ? [r.call] : [])),
    close: () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
        // Agents' HTTP clients may hold keep-alive sockets open.
        server.closeAllConnections();
      }),
  };
}
