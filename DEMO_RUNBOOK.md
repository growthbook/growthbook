# Demo runbook: CLI/agent auth via the OAuth 2.1 authorization server

**The story (60 seconds):** A user tells their coding agent "set up GrowthBook."
The agent opens a browser — no secret is ever typed into the chat. A brand-new
user creates their organization right on the consent page. The agent receives
an OAuth token and drives onboarding over the REST API: environment, SDK
connection, first feature flag.

Everything below runs from this worktree
(`.claude/worktrees/cranky-kepler-968278`), which is `main` + PR #6371 (OAuth
AS) + our two additions (zero-org consent flow, `scripts/gb-oauth-login.mjs`).

## One-time setup

1. **MongoDB** (the repo's `docker-compose.yml` does not publish the mongo
   port — use a standalone container):

   ```bash
   docker run -d --name gb-mongo-dev -p 27017:27017 \
     -e MONGO_INITDB_ROOT_USERNAME=root \
     -e MONGO_INITDB_ROOT_PASSWORD=password \
     mongo:latest
   ```

2. **Back-end env** — `packages/back-end/.env.local`:

   ```bash
   IS_CLOUD=false
   JWT_SECRET=dev-secret-key-for-local-development
   ENCRYPTION_KEY=dev-encryption-key-for-local-development
   APP_ORIGIN=http://localhost:3000
   API_HOST=http://localhost:3100
   EMAIL_ENABLED=false
   NODE_ENV=development
   MONGODB_URI=mongodb://root:password@localhost:27017/growthbook?authSource=admin

   OAUTH_AS_ENABLED=1
   # 24h access tokens so the demo never expires mid-run (default is 1h)
   OAUTH_ACCESS_TOKEN_TTL_SECONDS=86400
   ```

   Do **not** set `IS_MULTI_ORG` — on self-hosted it requires an enterprise
   license and blocks feature writes. The zero-org demo works without it as
   long as the DB has no org yet (Cloud gets multi-org via `IS_CLOUD`).

3. **Start the stack** (make sure mongo is up first — the back-end crashes and
   waits for a file change if it can't connect on boot):

   ```bash
   pnpm dev:apps
   ```

   Ready when `curl -s http://localhost:3100/healthcheck` returns healthy and
   http://localhost:3000 loads. (The Python stats-server error in the logs is
   harmless for this demo.)

## Reset to a clean state (run before each rehearsal/demo)

```bash
docker exec gb-mongo-dev mongosh -u root -p password \
  --authenticationDatabase admin growthbook --quiet --eval 'db.dropDatabase()'
# nudge the back-end to reconnect/restart
touch packages/back-end/src/app.ts
# clear stored tokens from previous runs
rm -f ~/.config/growthbook/.env ~/.config/growthbook/oauth.json
```

Also clear cookies for `localhost` in the demo browser (or use a fresh
private window) — a stale session from a dropped DB shows "Error Signing In";
if you see it, click **Log Out** and continue.

Then create the demo account (the "brand-new user" — exists, but has no
organization yet, exactly like a fresh Cloud signup):

```bash
curl -s -X POST http://localhost:3100/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"email":"founder@acme.dev","name":"Acme Founder","password":"DemoPassw0rd!Local3"}'
```

## The demo

### Act 1 — agent-initiated login (no secret in the chat)

```bash
node scripts/gb-oauth-login.mjs --client-name "Claude Code" --suggested-org-name "Acme Dev"
```

What happens (narrate while it runs):

1. The script discovers the OAuth server (RFC 8414), registers itself as a
   public client (RFC 7591 dynamic client registration), and starts a loopback
   listener on `127.0.0.1:<random>`.
2. The browser opens to the GrowthBook consent page with PKCE parameters.
3. Log in as `founder@acme.dev` (this is the one manual step — the user
   proving who they are to GrowthBook, in GrowthBook, not in the agent).

### Act 2 — zero-org inline organization creation

The consent page detects the user has **no organization** and shows the
inline creation form instead of dead-ending:

- "Claude Code wants to access your GrowthBook account"
- Organization name pre-filled with **Acme Dev** (passed by the agent via the
  `suggested_org_name` hint)
- One button: **Create organization & authorize**

Click it. The page creates the org, mints the auth code, and redirects to the
loopback listener. The terminal shows:

```
✓ Signed in. Access token saved to /Users/mc/.config/growthbook/.env
✓ Verified: token works against the REST API.
```

Point out: the token landed in `~/.config/growthbook/.env` — the exact file
the GrowthBook skills plugin and MCP server already read. Every existing
skill now works with zero changes.

### Act 3 — agent-driven onboarding over REST

```bash
AT=$(grep GB_API_KEY ~/.config/growthbook/.env | cut -d= -f2)
PROJ=$(curl -s http://localhost:3100/api/v1/projects -H "Authorization: Bearer $AT" | jq -r '.projects[0].id')

# environment
curl -s -X POST http://localhost:3100/api/v1/environments \
  -H "Authorization: Bearer $AT" -H 'Content-Type: application/json' \
  -d '{"id":"staging","description":"Staging environment"}' | jq '.environment.id'

# SDK connection (show the client key — this is what goes in their app)
curl -s -X POST http://localhost:3100/api/v1/sdk-connections \
  -H "Authorization: Bearer $AT" -H 'Content-Type: application/json' \
  -d "{\"name\":\"Web App\",\"language\":\"javascript\",\"environment\":\"production\",\"projects\":[\"$PROJ\"]}" \
  | jq '{id: .sdkConnection.id, clientKey: .sdkConnection.key}'

# first feature flag
curl -s -X POST http://localhost:3100/api/v1/features \
  -H "Authorization: Bearer $AT" -H 'Content-Type: application/json' \
  -d "{\"id\":\"welcome-banner\",\"valueType\":\"boolean\",\"defaultValue\":\"false\",\"owner\":\"founder@acme.dev\",\"project\":\"$PROJ\",\"environments\":{\"production\":{\"enabled\":true,\"rules\":[]}}}" \
  | jq '.feature.id'
```

Finish in the UI: log in at http://localhost:3000 and show the org, the
`welcome-banner` flag, and the SDK connection — all created by the agent.

Optional flourishes:

```bash
node scripts/gb-oauth-login.mjs --refresh   # rotating refresh tokens work
```

## Talking points

- **Standards-based, not bespoke.** This is OAuth 2.1 + PKCE + dynamic client
  registration ([PR #6371](https://github.com/growthbook/growthbook/pull/6371)).
  MCP clients (Claude Code, Cursor) speak exactly this protocol natively —
  the same server logs them in with zero client work on our side.
- **PATs are not replaced.** OAuth tokens (`gbo_…`) live in the same
  `apikeys` collection and authenticate identically. PATs remain first-class
  for CI, headless environments, and self-hosted without the flag.
- **Better lifecycle than a pasted PAT.** Short-lived access tokens, 30-day
  rotating refresh tokens, real revocation (revoke tears down the whole
  grant), audit-logged issuance.
- **Zero-org flow is our addition.** Upstream #6371 dead-ends brand-new users
  ("You are not a member of any organization"); our consent-page change turns
  first-touch onboarding into one click.

## What's demo-only vs. production-ready (be upfront if asked)

| Area                                              | Status                                                                               |
| ------------------------------------------------- | ------------------------------------------------------------------------------------ |
| OAuth server (discovery/DCR/token/refresh/revoke) | PR #6371, open — verified locally, incl. replay + rotation + teardown negatives      |
| Zero-org consent flow                             | Our patch on top of #6371 — to be PR'd against it                                    |
| Login script                                      | Demo-quality Node script; production home is `growthbook login` in the Go CLI        |
| DCR rate limiting                                 | Not implemented — public register endpoint is unthrottled (flagged for #6371 review) |
| `enforceSSO` orgs                                 | Interaction not yet verified (hardening item)                                        |
| Scopes / granular permissions                     | Tokens inherit the full user role; scope picker is the next refinement               |
| 24h token TTL                                     | Demo convenience — production default is 1h                                          |

## Troubleshooting

- **Back-end log shows "app crashed - waiting for file changes"** — mongo
  wasn't up when it booted. `touch packages/back-end/src/app.ts`.
- **"Error Signing In / Must be logged in"** — stale session cookie from a
  dropped DB. Click Log Out, then log in again.
- **Login script prints "Timed out waiting for browser authorization"** — the
  loopback listener waits 5 minutes; just re-run the script.
- **Feature creation returns "You need an enterprise license for multi-org"**
  — `IS_MULTI_ORG` is set; remove it from `.env.local` and restart.
- **Consent page shows "Unknown client_id"** — DB was reset after the script
  registered its client; re-run the script (it re-registers each login).
