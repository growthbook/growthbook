# Testing the CLI Auth POC (PR 1: Backend Only)

This document covers manual + scripted testing for the new `/cli-auth/*` endpoints. Since the SPA approval page (PR 2) isn't built yet, all tests here drive the API directly with `curl`/Node.

## Prerequisites

- Local GrowthBook stack running (`pnpm dev:back-end` or full `pnpm dev`)
- MongoDB up (Docker Compose default)
- At least one existing GrowthBook user account on the local instance with a session cookie + JWT you can grab from your browser devtools, OR a test fixture (instructions below)

### Grabbing a session JWT for testing

The simplest way:

1. Open `http://localhost:3000` in your browser and log in normally.
2. Open DevTools → Application → Cookies. Find the `id_token` cookie value.
3. Or, in DevTools → Network, look at any internal API request — grab the `Authorization: Bearer ...` header.
4. Note your `X-Organization` header value from the same request — that's the org you'll be approving for.

You'll use these for the `/cli-auth/approve` and `/cli-auth/request/:id` tests.

---

## Smoke test: happy path

This walks the whole flow with curl. Open three terminals.

### Terminal 1 — Init (public, no auth)

Generate a PKCE verifier + challenge first:

```bash
VERIFIER=$(openssl rand -base64 48 | tr -d '=+/' | cut -c -64)
CHALLENGE=$(printf '%s' "$VERIFIER" | openssl dgst -sha256 -binary | openssl base64 | tr -d '=' | tr '/+' '_-')

echo "VERIFIER=$VERIFIER"
echo "CHALLENGE=$CHALLENGE"
```

Call init:

```bash
curl -sX POST http://localhost:3100/cli-auth/init \
  -H 'Content-Type: application/json' \
  -d "{
    \"clientName\": \"Claude Code\",
    \"codeChallenge\": \"$CHALLENGE\",
    \"codeChallengeMethod\": \"S256\",
    \"suggestedOrgName\": \"My Test Org\"
  }" | jq .
```

**Expected:** 200 OK with `{ requestId, expiresAt, approveUrl }`.

Store the request ID:

```bash
REQUEST_ID=...   # paste from response
```

### Terminal 2 — Get request details (authed)

The SPA will hit this to render the approval card. Confirm it works:

```bash
curl -sX GET "http://localhost:3100/cli-auth/request/$REQUEST_ID" \
  -H "Authorization: Bearer $JWT" \
  -H "X-Organization: $ORG_ID" | jq .
```

**Expected:** 200 OK with `{ requestId, clientName: "Claude Code", suggestedOrgName: "My Test Org", status: "pending", expiresAt }`.

### Terminal 2 — Approve (authed)

```bash
curl -sX POST http://localhost:3100/cli-auth/approve \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $JWT" \
  -H "X-Organization: $ORG_ID" \
  -d "{
    \"requestId\": \"$REQUEST_ID\",
    \"organization\": \"$ORG_ID\",
    \"loopbackPort\": 49152
  }" | jq .
```

**Expected:** 200 OK with `{ exchangeCode, redirectUri }`. The redirect URI is what the SPA would navigate the browser to.

Store the exchange code:

```bash
EXCHANGE_CODE=...   # paste from response
```

### Terminal 3 — Exchange (public, no auth)

```bash
curl -sX POST http://localhost:3100/cli-auth/exchange \
  -H 'Content-Type: application/json' \
  -d "{
    \"requestId\": \"$REQUEST_ID\",
    \"exchangeCode\": \"$EXCHANGE_CODE\",
    \"codeVerifier\": \"$VERIFIER\"
  }" | jq .
```

**Expected:** 200 OK with `{ apiKey, organization, userEmail, keyId }`. The `apiKey` is a plaintext PAT — verify it starts with `secret_user_`.

### Verify the PAT works

```bash
PAT=...   # paste apiKey from response

curl -s http://localhost:3100/api/v1/projects \
  -H "Authorization: Bearer $PAT" | jq .
```

**Expected:** A list of projects (or empty array if none) — 200 OK.

### Verify the PAT shows up in the UI

Visit `http://localhost:3000/account/personal-access-tokens`. You should see a token with description `CLI: Claude Code (unknown) — <today>`.

---

## Negative-path tests

### Replay attempt: exchange already-exchanged code

Re-run the exchange call from above with the same `REQUEST_ID`, `EXCHANGE_CODE`, `VERIFIER`. **Expected:** 400 with `Exchange failed: wrong_state`.

### Wrong PKCE verifier

Init a fresh request, approve it, then exchange with the wrong verifier:

```bash
curl -sX POST http://localhost:3100/cli-auth/exchange \
  -H 'Content-Type: application/json' \
  -d "{
    \"requestId\": \"$NEW_REQUEST_ID\",
    \"exchangeCode\": \"$NEW_EXCHANGE_CODE\",
    \"codeVerifier\": \"not-the-real-verifier-must-be-at-least-43-chars-long-aaaaaa\"
  }"
```

**Expected:** 400 with `Exchange failed: bad_verifier`. The doc's `exchangeAttempts` should increment. Repeat 3× and you get `too_many_attempts` (429).

### Wrong exchange code

Same setup, but pass a bogus exchange code with the correct verifier. **Expected:** 400 `bad_code`, attempts increment.

### Expired request

Init a request, wait 10+ minutes, try to approve. **Expected:** 410 `Request expired`. (For faster testing, edit the doc in mongo: `db.cliauthrequests.updateOne({requestId: "..."}, {$set: {expiresAt: new Date(0)}})`.)

### Approve with mismatched org

```bash
curl -sX POST http://localhost:3100/cli-auth/approve \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $JWT" \
  -H "X-Organization: $ORG_ID" \
  -d "{
    \"requestId\": \"$REQUEST_ID\",
    \"organization\": \"some_other_org\",
    \"loopbackPort\": 49152
  }"
```

**Expected:** 400 `Organization mismatch`.

### Approve without auth

```bash
curl -sX POST http://localhost:3100/cli-auth/approve \
  -H 'Content-Type: application/json' \
  -d "{ ... }"
```

**Expected:** 401 (handled by processJWT middleware before reaching our handler).

### Double-approve

Approve once successfully, then call approve again with the same request_id. **Expected:** 409 `Request already used`.

### Init with invalid client name

```bash
curl -sX POST http://localhost:3100/cli-auth/init \
  -H 'Content-Type: application/json' \
  -d '{
    "clientName": "<script>",
    "codeChallenge": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "codeChallengeMethod": "S256"
  }'
```

**Expected:** 400 validation error (regex on `clientName` rejects `<` and `>`).

### Init with too-short challenge

```bash
curl -sX POST http://localhost:3100/cli-auth/init \
  -H 'Content-Type: application/json' \
  -d '{
    "clientName": "Claude Code",
    "codeChallenge": "short",
    "codeChallengeMethod": "S256"
  }'
```

**Expected:** 400 validation error.

### Init with wrong challenge method

```bash
curl -sX POST http://localhost:3100/cli-auth/init \
  -H 'Content-Type: application/json' \
  -d '{
    "clientName": "Claude Code",
    "codeChallenge": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "codeChallengeMethod": "plain"
  }'
```

**Expected:** 400 validation error.

---

## End-to-end driver script

A Node script that automates the whole happy path — useful for repeatable smoke tests and as the basis for future integration tests. Save as `scripts/cli-auth-smoke.ts` and run with `npx ts-node` (or copy/paste into a REPL).

```typescript
import crypto from "crypto";

const API = process.env.GB_API ?? "http://localhost:3100";
const JWT = process.env.GB_JWT!; // your session JWT
const ORG = process.env.GB_ORG!; // your org id

function b64url(buf: Buffer | string) {
  return (typeof buf === "string" ? Buffer.from(buf) : buf)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

async function main() {
  const verifier = b64url(crypto.randomBytes(48));
  const challenge = b64url(
    crypto.createHash("sha256").update(verifier).digest(),
  );

  // 1. init
  const initRes = await fetch(`${API}/cli-auth/init`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      clientName: "Smoke Test",
      codeChallenge: challenge,
      codeChallengeMethod: "S256",
    }),
  });
  const init = await initRes.json();
  console.log("INIT:", init);

  // 2. (skip get-request, optional)

  // 3. approve
  const approveRes = await fetch(`${API}/cli-auth/approve`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${JWT}`,
      "X-Organization": ORG,
    },
    body: JSON.stringify({
      requestId: init.requestId,
      organization: ORG,
      loopbackPort: 49152,
    }),
  });
  const approve = await approveRes.json();
  console.log("APPROVE:", approve);

  // 4. exchange
  const exRes = await fetch(`${API}/cli-auth/exchange`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      requestId: init.requestId,
      exchangeCode: approve.exchangeCode,
      codeVerifier: verifier,
    }),
  });
  const ex = await exRes.json();
  console.log("EXCHANGE:", ex);

  // 5. verify the PAT
  const projRes = await fetch(`${API}/api/v1/projects`, {
    headers: { Authorization: `Bearer ${ex.apiKey}` },
  });
  console.log("PAT WORKS:", projRes.status, await projRes.json());
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

Run:

```bash
export GB_JWT="eyJ..."  # from browser
export GB_ORG="org_..."
npx ts-node scripts/cli-auth-smoke.ts
```

---

## What to manually verify after a successful run

- [ ] The PAT shows up at `/account/personal-access-tokens` with the expected `CLI: ...` description.
- [ ] The PAT works for at least one REST call (`GET /api/v1/projects`).
- [ ] The `cliauthrequests` collection has the doc in status `exchanged` (`db.cliauthrequests.findOne({requestId: "..."})`).
- [ ] After 1 hour, the document is gone (Mongo TTL — wait or restart and check).

## Things NOT yet tested (deferred to later PRs)

- SPA approval page (PR 2) — won't exist until front-end is built.
- Inline org creation for zero-org users (PR 2).
- User-code matching against phishing (hardening — see CLI_AUTH_DESIGN.md launch-blocker checklist).
- Device Code Grant fallback (hardening).
- `enforceSSO` respect (hardening).
- Audit logging on PAT creation (hardening).
- Concurrent approve race conditions (the atomic mongo `updateOne` should handle it, but no stress test yet).

## Known caveats during POC

- The PAT description always shows `hostname=unknown` because the CLI doesn't pass `X-CLI-Auth-Hostname` yet. Once the CLI lands in PR 4, hostname will populate.
- If the SPA isn't built yet but you want to test the redirect manually, after `/cli-auth/approve` you can simply curl the `/cli-auth/exchange` directly with the returned `exchangeCode`. The redirect URI is just a hint.
- The exchange endpoint is currently rate-limited only by the global 60/min — per-`request_id` brute-force protection is in handler code (3 attempts) but no IP-level throttling. Hardening before prod.
