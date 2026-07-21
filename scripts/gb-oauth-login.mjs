#!/usr/bin/env node
/**
 * GrowthBook OAuth 2.1 login for CLIs and agents.
 *
 * Performs the standard native-app flow against the GrowthBook OAuth
 * authorization server (requires OAUTH_AS_ENABLED=1 on the API host):
 *
 *   1. Discovery (RFC 8414) at /.well-known/oauth-authorization-server
 *   2. Dynamic client registration (RFC 7591) with a loopback redirect URI
 *   3. Authorization code + PKCE (S256) via the user's browser
 *   4. Token exchange on the loopback callback
 *
 * On success, writes the access token as GB_API_KEY to
 * ~/.config/growthbook/.env (the file read by the GrowthBook skills plugin
 * and MCP server) and stores the refresh token + client id in
 * ~/.config/growthbook/oauth.json for later refresh.
 *
 * Usage:
 *   node scripts/gb-oauth-login.mjs [options]
 *
 * Options:
 *   --api-host <url>            API host (default http://localhost:3100)
 *   --client-name <name>        Client name shown on the consent page
 *                               (default "GrowthBook CLI")
 *   --suggested-org-name <name> Pre-fills the org name for brand-new users
 *   --no-browser                Print the authorize URL instead of opening it
 *   --refresh                   Refresh the stored token instead of a full login
 */

import crypto from "node:crypto";
import http from "node:http";
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const CONFIG_DIR = path.join(os.homedir(), ".config", "growthbook");
const ENV_FILE = path.join(CONFIG_DIR, ".env");
const OAUTH_FILE = path.join(CONFIG_DIR, "oauth.json");
const CALLBACK_TIMEOUT_MS = 5 * 60 * 1000;

function parseArgs(argv) {
  const args = {
    apiHost: "http://localhost:3100",
    clientName: "GrowthBook CLI",
    suggestedOrgName: "",
    openBrowser: true,
    refresh: false,
  };
  for (let i = 2; i < argv.length; i++) {
    switch (argv[i]) {
      case "--api-host":
        args.apiHost = argv[++i].replace(/\/+$/, "");
        break;
      case "--client-name":
        args.clientName = argv[++i];
        break;
      case "--suggested-org-name":
        args.suggestedOrgName = argv[++i];
        break;
      case "--no-browser":
        args.openBrowser = false;
        break;
      case "--refresh":
        args.refresh = true;
        break;
      default:
        fail(`Unknown option: ${argv[i]}`);
    }
  }
  return args;
}

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

function b64url(buf) {
  return buf
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      data.error_description || data.error || `${res.status} from ${url}`,
    );
  }
  return data;
}

function readStoredOauth() {
  try {
    return JSON.parse(readFileSync(OAUTH_FILE, "utf8"));
  } catch {
    return null;
  }
}

/**
 * Write config files. Directory perms first (0700), then files at 0600, so
 * the secret is never world-readable even transiently.
 */
function persistTokens({ apiHost, clientId, tokens }) {
  mkdirSync(CONFIG_DIR, { recursive: true });
  chmodSync(CONFIG_DIR, 0o700);

  // Preserve unrelated lines (e.g. GB_EMAIL) in an existing .env
  let lines = [];
  try {
    lines = readFileSync(ENV_FILE, "utf8")
      .split("\n")
      .filter((l) => l && !l.startsWith("GB_API_KEY=") && !l.startsWith("GB_API_URL="));
  } catch {
    // no existing file
  }
  lines.unshift(`GB_API_KEY=${tokens.access_token}`);
  if (!/^https?:\/\/api\.growthbook\.io$/.test(apiHost)) {
    lines.push(`GB_API_URL=${apiHost}`);
  }
  writeFileSync(ENV_FILE, lines.join("\n") + "\n");
  chmodSync(ENV_FILE, 0o600);

  writeFileSync(
    OAUTH_FILE,
    JSON.stringify(
      {
        apiHost,
        clientId,
        refreshToken: tokens.refresh_token,
        accessTokenExpiresAt: new Date(
          Date.now() + tokens.expires_in * 1000,
        ).toISOString(),
      },
      null,
      2,
    ) + "\n",
  );
  chmodSync(OAUTH_FILE, 0o600);
}

async function refreshFlow() {
  const stored = readStoredOauth();
  if (!stored?.refreshToken || !stored?.clientId) {
    fail("No stored refresh token. Run a full login first (omit --refresh).");
  }
  const meta = await fetch(
    `${stored.apiHost}/.well-known/oauth-authorization-server`,
  ).then((r) => r.json());
  const tokens = await postJson(meta.token_endpoint, {
    grant_type: "refresh_token",
    refresh_token: stored.refreshToken,
    client_id: stored.clientId,
  });
  persistTokens({
    apiHost: stored.apiHost,
    clientId: stored.clientId,
    tokens,
  });
  console.log(
    `✓ Token refreshed. Expires ${new Date(Date.now() + tokens.expires_in * 1000).toLocaleString()}.`,
  );
}

async function loginFlow(args) {
  // 1. Discovery
  const metaRes = await fetch(
    `${args.apiHost}/.well-known/oauth-authorization-server`,
  );
  if (!metaRes.ok) {
    fail(
      `OAuth discovery failed (${metaRes.status}). Is OAUTH_AS_ENABLED=1 set on ${args.apiHost}?`,
    );
  }
  const meta = await metaRes.json();

  // 2. Loopback listener on a random port
  const server = http.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const redirectUri = `http://127.0.0.1:${port}/callback`;

  // 3. Dynamic client registration bound to this redirect URI.
  //    (The server validates redirect_uri by exact match, so we register per
  //    login while the loopback port is random.)
  const client = await postJson(meta.registration_endpoint, {
    client_name: args.clientName,
    redirect_uris: [redirectUri],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  });

  // 4. PKCE + state
  const verifier = b64url(crypto.randomBytes(48));
  const challenge = b64url(
    crypto.createHash("sha256").update(verifier, "ascii").digest(),
  );
  const state = b64url(crypto.randomBytes(16));

  const authorizeUrl = new URL(meta.authorization_endpoint);
  authorizeUrl.searchParams.set("client_id", client.client_id);
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("code_challenge", challenge);
  authorizeUrl.searchParams.set("code_challenge_method", "S256");
  authorizeUrl.searchParams.set("state", state);
  if (args.suggestedOrgName) {
    authorizeUrl.searchParams.set("suggested_org_name", args.suggestedOrgName);
  }

  // 5. Send the user to the consent page
  if (args.openBrowser) {
    console.log("Opening your browser to authorize…");
    const opener =
      process.platform === "darwin"
        ? "open"
        : process.platform === "win32"
          ? "start"
          : "xdg-open";
    spawn(opener, [authorizeUrl.toString()], {
      stdio: "ignore",
      detached: true,
    }).unref();
    console.log(`If the browser did not open, visit:\n  ${authorizeUrl}`);
  } else {
    console.log(`Visit this URL to authorize:\n  ${authorizeUrl}`);
  }

  // 6. Wait for the loopback callback
  const { code } = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      server.close();
      reject(new Error("Timed out waiting for browser authorization"));
    }, CALLBACK_TIMEOUT_MS);

    server.on("request", (req, res) => {
      const url = new URL(req.url, redirectUri);
      if (url.pathname !== "/callback") {
        res.writeHead(404).end();
        return;
      }
      const err = url.searchParams.get("error");
      const returnedState = url.searchParams.get("state");
      const returnedCode = url.searchParams.get("code");

      let message;
      if (err) {
        message = `Authorization failed: ${url.searchParams.get("error_description") || err}`;
      } else if (returnedState !== state) {
        message = "Authorization failed: state mismatch";
      } else if (!returnedCode) {
        message = "Authorization failed: no code returned";
      } else {
        message = "Signed in to GrowthBook. You can close this tab.";
      }

      res.writeHead(err || returnedState !== state || !returnedCode ? 400 : 200, {
        "Content-Type": "text/html",
      });
      res.end(
        `<!doctype html><meta charset="utf-8"><title>GrowthBook</title><body style="font-family:system-ui;margin:4rem auto;max-width:28rem;text-align:center"><h2>${message}</h2></body>`,
      );

      clearTimeout(timer);
      server.close();
      if (err || returnedState !== state || !returnedCode) {
        reject(new Error(message));
      } else {
        resolve({ code: returnedCode });
      }
    });
  });

  // 7. Exchange the code
  const tokens = await postJson(meta.token_endpoint, {
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: client.client_id,
    code_verifier: verifier,
  });

  persistTokens({
    apiHost: args.apiHost,
    clientId: client.client_id,
    tokens,
  });

  // 8. Sanity-check the token against the REST API
  const check = await fetch(`${args.apiHost}/api/v1/projects`, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });

  console.log("");
  console.log(`✓ Signed in. Access token saved to ${ENV_FILE}`);
  console.log(
    `  Token expires ${new Date(Date.now() + tokens.expires_in * 1000).toLocaleString()}; refresh with --refresh.`,
  );
  console.log(
    check.ok
      ? "✓ Verified: token works against the REST API."
      : `✗ Warning: REST API check returned ${check.status}.`,
  );
}

const args = parseArgs(process.argv);
(args.refresh ? refreshFlow() : loginFlow(args)).catch((e) => fail(e.message));
