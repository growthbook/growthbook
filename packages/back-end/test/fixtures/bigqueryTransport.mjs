import "tsx/cjs";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createServer as createTlsServer } from "node:https";
import { BlockList, connect, isIP } from "node:net";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import path from "node:path";

const fixtureDirectory = path.dirname(fileURLToPath(import.meta.url));
const fixtureRequire = createRequire(import.meta.url);
const sdkRequire = createRequire(
  fixtureRequire.resolve("@google-cloud/bigquery"),
);
const commonRequire = createRequire(sdkRequire.resolve("@google-cloud/common"));
const { OAuth2Client } = commonRequire("google-auth-library");

async function listen(server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return server.address().port;
}

async function main() {
  // This key and certificate are synthetic and used only by the local TLS server.
  const pem = readFileSync(
    path.join(fixtureDirectory, "bigqueryTransport.pem"),
    "utf8",
  );
  const tunnels = [];
  let internalRequests = 0;
  let redirect = null;
  const sockets = new Set();
  function track(socket) {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    return socket;
  }

  const tokenServer = createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        access_token: "synthetic-access-token",
        expires_in: 3600,
        token_type: "Bearer",
      }),
    );
  });
  const internal = createServer((req, res) => {
    internalRequests++;
    res.end(JSON.stringify({ datasets: [] }));
  });
  const endpoint = createTlsServer({ key: pem, cert: pem }, (req, res) => {
    if (redirect) {
      res.writeHead(307, { Location: redirect });
      res.end();
    } else {
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          datasets: [{ datasetReference: { datasetId: "safe_dataset" } }],
        }),
      );
    }
  });
  const proxy = createServer();
  const servers = [tokenServer, internal, endpoint, proxy];
  for (const server of servers) server.on("connection", track);

  try {
    const tokenPort = await listen(tokenServer);
    const internalPort = await listen(internal);
    const endpointPort = await listen(endpoint);
    // Like the egress proxy: no allowlist, public hosts pass and private addresses are denied.
    const privateRanges = new BlockList();
    privateRanges.addSubnet("127.0.0.0", 8);
    privateRanges.addSubnet("10.0.0.0", 8);
    privateRanges.addSubnet("169.254.0.0", 16);
    const publicHosts = { "customer-proxy.invalid:443": endpointPort };
    proxy.on("connect", (req, socket, head) => {
      tunnels.push(req.url);
      const host = req.url.slice(0, req.url.lastIndexOf(":"));
      if (isIP(host) && privateRanges.check(host)) {
        socket.end("HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n");
        return;
      }
      const upstream = track(
        connect(publicHosts[req.url], "127.0.0.1", () => {
          socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
          if (head.length) upstream.write(head);
          socket.pipe(upstream).pipe(socket);
        }),
      );
      upstream.on("error", () => socket.destroy());
      socket.on("error", () => upstream.destroy());
    });
    const proxyPort = await listen(proxy);

    // Deployment configuration, read by secrets.ts when the real factory loads it.
    process.env.IS_CLOUD = "true";
    process.env.WEBHOOK_PROXY = `http://127.0.0.1:${proxyPort}`;
    const { createBigQueryClient } = fixtureRequire(
      "../../src/services/bigqueryClient.ts",
    );
    const authClient = new OAuth2Client({
      endpoints: { oauth2TokenUrl: `http://127.0.0.1:${tokenPort}/token` },
    });
    authClient.setCredentials({ refresh_token: "synthetic-refresh-token" });
    const client = createBigQueryClient({
      apiEndpoint: "https://customer-proxy.invalid/tenant",
      authClient,
      autoRetry: false,
      timeout: 1000,
    });

    // API requests reach the endpoint only through the proxy.
    const [datasets] = await client.getDatasets();
    assert.equal(datasets[0].id, "safe_dataset");
    assert.deepEqual(tunnels, ["customer-proxy.invalid:443"]);

    // Redirects reuse the request's proxy agent, so each hop is filtered like the first.
    redirect = `http://127.0.0.1:${internalPort}/datasets`;
    await assert.rejects(client.getDatasets(), /403|Forbidden/i);
    assert.equal(internalRequests, 0);
    assert.deepEqual(tunnels.slice(1), [
      "customer-proxy.invalid:443",
      `127.0.0.1:${internalPort}`,
    ]);

    // An unreachable proxy fails the request instead of falling back to a direct connection.
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => proxy.close(resolve));
    await assert.rejects(client.getDatasets(), /ECONNREFUSED/);
  } finally {
    for (const socket of sockets) socket.destroy();
    await Promise.all(
      servers.map((server) => new Promise((resolve) => server.close(resolve))),
    );
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack}\n`);
  process.exitCode = 1;
});
