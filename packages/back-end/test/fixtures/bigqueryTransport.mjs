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
  // This key and certificate are synthetic and used only by the local TLS servers.
  const pem = readFileSync(
    path.join(fixtureDirectory, "bigqueryTransport.pem"),
    "utf8",
  );
  let endpointRequests = 0;
  let tokenRequests = 0;
  let internalRequests = 0;
  const thirdPartyAuthorization = [];
  let proxyConnections = 0;
  const deniedTunnels = [];
  let deny = false;
  let redirect = null;
  const sockets = new Set();
  function track(socket) {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    return socket;
  }

  const tokenServer = createServer((req, res) => {
    tokenRequests++;
    assert.equal(req.url, "/token");
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
  const thirdParty = createTlsServer({ key: pem, cert: pem }, (req, res) => {
    thirdPartyAuthorization.push(req.headers.authorization);
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ datasets: [] }));
  });
  const endpoint = createTlsServer({ key: pem, cert: pem }, (req, res) => {
    endpointRequests++;
    assert.equal(req.headers.authorization, "Bearer synthetic-access-token");
    assert.equal(
      new URL(req.url, "https://customer-proxy.invalid").pathname,
      "/tenant/bigquery/v2/projects/synthetic-project/datasets",
    );
    if (redirect) {
      res.writeHead(redirect.status, { Location: redirect.location });
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
  const servers = [tokenServer, internal, thirdParty, endpoint, proxy];
  for (const server of servers) server.on("connection", track);

  try {
    const tokenPort = await listen(tokenServer);
    const internalPort = await listen(internal);
    const thirdPartyPort = await listen(thirdParty);
    const endpointPort = await listen(endpoint);
    // Like the egress proxy: no allowlist, public hosts pass and private addresses are denied.
    const privateRanges = new BlockList();
    privateRanges.addSubnet("127.0.0.0", 8);
    privateRanges.addSubnet("10.0.0.0", 8);
    privateRanges.addSubnet("169.254.0.0", 16);
    const publicHosts = {
      "customer-proxy.invalid:443": endpointPort,
      "third-party.invalid:443": thirdPartyPort,
    };
    proxy.on("connect", (req, socket, head) => {
      proxyConnections++;
      assert.equal(req.headers.authorization, undefined);
      const host = req.url.slice(0, req.url.lastIndexOf(":"));
      if (deny || (isIP(host) && privateRanges.check(host))) {
        deniedTunnels.push(req.url);
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
    const apiEndpoint = "https://customer-proxy.invalid/tenant";
    // Substitute only deployment configuration; load the real factory and SDK.
    const secretsPath = fixtureRequire.resolve("../../src/util/secrets.ts");
    const secrets = fixtureRequire(secretsPath);
    fixtureRequire.cache[secretsPath].exports = {
      ...secrets,
      IS_CLOUD: true,
      WEBHOOK_PROXY: `http://127.0.0.1:${proxyPort}`,
    };
    const { createBigQueryClient } = fixtureRequire(
      "../../src/services/bigqueryClient.ts",
    );
    const authClient = new OAuth2Client({
      endpoints: { oauth2TokenUrl: `http://127.0.0.1:${tokenPort}/token` },
    });
    authClient.setCredentials({ refresh_token: "synthetic-refresh-token" });
    const clientOptions = {
      apiEndpoint,
      authClient,
      autoRetry: false,
      timeout: 1000,
    };
    const client = createBigQueryClient(clientOptions);

    const [datasets] = await client.getDatasets();
    assert.equal(datasets[0].id, "safe_dataset");
    assert.equal(tokenRequests, 1);
    assert.equal(proxyConnections, 1);
    assert.equal(endpointRequests, 1);
    assert.equal(await client.getProjectId(), "synthetic-project");

    const escapingClient = createBigQueryClient({
      ...clientOptions,
      projectId: "../../../../admin",
    });
    await assert.rejects(
      escapingClient.getDatasets(),
      /must use its configured API endpoint/,
    );
    assert.equal(proxyConnections, 1);
    assert.equal(endpointRequests, 1);

    // Redirects reuse the request's proxy agent, so each hop is filtered like the first.
    redirect = {
      status: 307,
      location: `http://127.0.0.1:${internalPort}/datasets`,
    };
    await assert.rejects(client.getDatasets(), /403|Forbidden/i);
    assert.equal(endpointRequests, 2);
    assert.equal(internalRequests, 0);
    assert.deepEqual(deniedTunnels, [`127.0.0.1:${internalPort}`]);

    // A public redirect target is reachable, but never receives the access token.
    redirect = {
      status: 307,
      location: "https://third-party.invalid/datasets",
    };
    await client.getDatasets();
    assert.equal(endpointRequests, 3);
    assert.deepEqual(thirdPartyAuthorization, [undefined]);

    deny = true;
    const before = endpointRequests;
    await assert.rejects(client.getDatasets(), /403|Forbidden/i);
    assert.equal(endpointRequests, before);

    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => proxy.close(resolve));
    await assert.rejects(client.getDatasets(), /ECONNREFUSED/);
    assert.equal(endpointRequests, before);
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
