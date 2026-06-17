# CLI / Agent Authentication for GrowthBook

**Status:** Draft v1
**Author:** (design pass with Claude)
**Date:** 2026-05-13
**Scope:** Cloud only (self-hosted deferred)

## Problem

A coding agent (Claude Code, Claude Desktop, MCP server, future CLIs) needs to obtain a GrowthBook Personal Access Token without a human pasting it from the UI. Today the only path is:

1. User signs in to the web app
2. User navigates to **Personal Access Tokens**
3. User clicks **Create token**, copies the plaintext, pastes it into the agent's config

Every onboarding session repeats those three steps manually. We want one command — `gb auth login` or equivalent — that takes care of it.

## Goals

- One-command auth bootstrap for a new GrowthBook customer.
- PAT inherits the user's role (no scope selection in v1).
- Works on Cloud SSO (Auth0/OIDC) without the agent ever seeing user credentials.
- Token stored securely on the user's machine (OS keychain preferred, env file fallback).
- After auth, the agent can drive the full onboarding flow over the public REST API.

## Non-goals (v1)

- Self-hosted support. (Same protocol will work; URLs need to be configurable. Defer to v2.)
- Org Secret Keys (role-scoped). PAT only in v1.
- Sandboxed / SSH-only environments. (Add Device Code Grant in v1.1 as fallback.)
- Member invites via REST. (Stays manual; out of v1 onboarding scope.)
- Token rotation / refresh. (PATs are long-lived; revoke + re-auth is the v1 story.)

## Architecture: Loopback Redirect Flow

Standard OAuth-style loopback, adapted to GrowthBook's existing cookie-based session auth. The agent never sees the user's password or SSO tokens — only a one-time code that it exchanges for a PAT.

### Sequence

```
Agent                          Browser                       GrowthBook (api + app)
  │                               │                                  │
  │ 1. POST /cli-auth/init        │                                  │
  ├──────────────────────────────────────────────────────────────────►
  │   { client_name, scopes? }                                       │
  │ ◄──────────────────────────────────────────────────────────────  │
  │   { request_id, expires_at,                                      │
  │     approve_url }                                                │
  │                               │                                  │
  │ 2. start localhost listener   │                                  │
  │    on 127.0.0.1:<port>        │                                  │
  │                               │                                  │
  │ 3. open browser to            │                                  │
  │    approve_url + &port=<port> │                                  │
  ├──────────────────────────────►│                                  │
  │                               │ 4. /cli-auth?req=<id>&port=<p>   │
  │                               ├─────────────────────────────────►│
  │                               │   (SPA — if no session, falls    │
  │                               │    into normal SSO flow,         │
  │                               │    returns here after callback)  │
  │                               │                                  │
  │                               │ 5. user sees approval page:      │
  │                               │    "Claude Code wants to create  │
  │                               │     a Personal Access Token in   │
  │                               │     org [Acme]. Approve?"        │
  │                               │                                  │
  │                               │ 6. user clicks Approve           │
  │                               │    POST /cli-auth/approve        │
  │                               │    { request_id, organization }  │
  │                               ├─────────────────────────────────►│
  │                               │                                  │ ─┐
  │                               │                                  │  │ Mint PAT
  │                               │                                  │  │ (existing /keys
  │                               │                                  │  │  logic, type:"user")
  │                               │                                  │ ◄┘
  │                               │ ◄────────────────────────────────│
  │                               │   { exchange_code }              │
  │                               │                                  │
  │                               │ 7. window.location.replace(      │
  │                               │      "http://127.0.0.1:<port>"   │
  │                               │      + "/callback?code=<code>")  │
  │ ◄─────────────────────────────│                                  │
  │   GET /callback?code=<code>   │                                  │
  │                               │                                  │
  │ 8. POST /cli-auth/exchange    │                                  │
  ├──────────────────────────────────────────────────────────────────►
  │   { request_id, exchange_code,                                   │
  │     code_verifier }                                              │
  │ ◄────────────────────────────────────────────────────────────────│
  │   { api_key, organization,                                       │
  │     user_email, expires_at? }                                    │
  │                               │                                  │
  │ 9. store in keychain          │                                  │
  │                               │                                  │
  │ 10. respond to browser tab    │                                  │
  │     "You can close this tab"  │                                  │
  │                               │                                  │
```

### Security properties

- **PKCE-style binding** (step 1 + 8): agent generates `code_verifier`, sends `code_challenge = sha256(code_verifier)` in `/cli-auth/init`. Server stores the challenge with the `request_id`. On `/cli-auth/exchange`, the agent presents the verifier; server verifies. Prevents another local process from racing the loopback callback.
- **Single-use exchange code**, ≤2 min TTL.
- **Loopback redirect target validated** against the port the agent registered.
- **Approval page is session-authenticated** — only the logged-in user can mint a PAT, and only for their own user_id.
- **`request_id` expires** in 10 minutes if not approved.
- **PAT description** auto-set to `"CLI: {client_name} ({hostname}) — {date}"` so users can see and revoke from the existing Personal Access Tokens UI.

## Backend Changes

### New endpoints

All three live in a new router: `packages/back-end/src/routers/cli-auth/cli-auth.router.ts`.

#### `POST /cli-auth/init`

- **Auth:** none (public)
- **Rate limit:** 10/min per IP (new — add to api.router.ts)
- **Body:**
  ```ts
  {
    client_name: string,         // "Claude Code", shown to user
    code_challenge: string,      // base64url(sha256(verifier))
    code_challenge_method: "S256",
    suggested_org_name?: string  // optional, pre-fills the org-creation form
                                 // for brand-new users with no org yet
  }
  ```
- **Response:**
  ```ts
  {
    request_id: string,          // opaque, ~32 bytes
    expires_at: string,          // ISO, +10min
    approve_url: string          // e.g. https://app.growthbook.io/cli-auth?req=<id>
  }
  ```
- **Storage:** new collection `cli_auth_requests`:
  ```ts
  {
    id: string,                  // request_id
    client_name: string,
    code_challenge: string,
    status: "pending" | "approved" | "exchanged" | "expired",
    user_id?: string,            // set on approve
    organization_id?: string,    // set on approve
    api_key_id?: string,         // set on approve (refs ApiKey._id)
    exchange_code?: string,      // hashed, set on approve
    loopback_port?: number,      // recorded for audit
    created_at: Date,
    expires_at: Date,
    approved_at?: Date,
    exchanged_at?: Date,
  }
  ```
  TTL index on `expires_at`.

#### `POST /cli-auth/approve`

- **Auth:** standard web session (uses existing `processJWT` middleware)
- **Body:**
  ```ts
  {
    request_id: string,
    organization: string,        // org user is approving for
    loopback_port: number        // 1-65535
  }
  ```
- **Logic:**
  1. Load request by `request_id`. Reject if not `pending` or expired.
  2. Verify `req.userId` matches a user with a membership in `organization`.
  3. Call existing `createUserPersonalAccessApiKey()` with `userId = req.userId`, description `"CLI: ${client_name} (${hostname || 'unknown'}) — ${today}"`.
  4. Generate `exchange_code` (32 bytes, base64url). Store its hash on the request.
  5. Update request: `status: "approved"`, persist `user_id`, `organization_id`, `api_key_id`, `loopback_port`, `approved_at`.
  6. Return `{ exchange_code, redirect_uri: "http://127.0.0.1:<port>/callback?code=<code>&state=<req_id>" }`. The SPA performs `window.location.replace(redirect_uri)`.
- **Audit log:** add a new event `cliAuth.approve` with the request_id, client_name, user_id, organization. (Not on the existing PAT — the PAT itself isn't audit-logged today, but this approval should be.)

#### `POST /cli-auth/exchange`

- **Auth:** none (public — the exchange_code is the auth)
- **Body:**
  ```ts
  {
    request_id: string,
    exchange_code: string,
    code_verifier: string        // PKCE verifier
  }
  ```
- **Logic:**
  1. Load request. Must be `status: "approved"`, within TTL.
  2. Verify `sha256(code_verifier) === code_challenge`.
  3. Verify `hash(exchange_code) === stored hash`.
  4. Mark `status: "exchanged"`, `exchanged_at: now`. Refuse if already exchanged.
  5. Load the minted ApiKey, return `{ api_key: <plaintext>, organization, user_email, key_id }`.
- **One-shot:** after exchange, the request is dead. Re-running the flow requires a new `/cli-auth/init`.

### Model

New model `CliAuthRequestModel` (BaseModel) for the new collection. Permissions: `canRead` self only; `canCreate` always true; no update/delete needed (state machine handled in handlers).

### REST API gap closers (v1)

For the "complete onboarding flow" the user mentioned:

- ✅ Projects, Environments, SDK Connections, Features, Metrics, Org Settings — already in REST.
- ❌ **Data Sources:** add `POST /v1/data-sources` (and `GET` if not present). The internal handler at `app.ts:922` should be portable — wrap it in the spec/handler pattern from [api-patterns.md](.cursor/rules/backend/api-patterns.md).
- ⏸ **Member invites:** defer. Skill output should print "to invite teammates, visit Settings → Team".

## Front-End Changes

### New page: `/cli-auth`

`packages/front-end/pages/cli-auth/index.tsx`. Behavior:

1. If no JWT, fall through to the existing auth flow — `AuthProvider` will redirect to SSO, and after callback the user lands back at `/cli-auth?req=...&port=...` (preserved in the post-login redirect, which already works via existing return-URL handling).
2. Once authenticated, read `req` from query string. Fetch request details via `GET /cli-auth/requests/:id` (new, session-auth, returns `{ client_name, expires_at, status }` — used purely for UX).
3. Render approval card:
   - **Title:** "Authorize {client_name}"
   - **Body:** "This will create a Personal Access Token in your GrowthBook account. The token will have the same permissions as your user role and can be revoked at any time from Settings → Personal Access Tokens."
   - **Org picker** (`Select`) — defaults to user's only/first org. Hidden if user has exactly one org.
   - **Approve** / **Cancel** buttons.
4. On Approve: `apiCall("/cli-auth/approve", { method: "POST", body: ... })`, then `window.location.replace(response.redirect_uri)`.
5. After redirect, the browser tab lands on the agent's loopback server, which responds with a small HTML page: "You can close this tab and return to {client_name}."

Reuse existing components: `Callout`, `Button`, `Select` from `@/ui/*`. No new design system additions needed.

### Zero-org case (brand-new user)

When a user signs up via SSO for the first time and lands on `/cli-auth?req=...`, they don't have an org yet. Sending them to `/setup` (or worse, `/getstarted`) here breaks the flow — they lose the approval context and have to figure out what to do next.

Instead, the `/cli-auth` page handles org creation **inline**, as a one-screen prelude to approval:

```
┌──────────────────────────────────────────────┐
│  Welcome to GrowthBook                       │
│                                              │
│  Claude Code is asking to connect to your    │
│  GrowthBook account. To get started, let's   │
│  set up your organization.                   │
│                                              │
│  Organization name                           │
│  ┌────────────────────────────────────────┐  │
│  │ Acme                                   │  │
│  └────────────────────────────────────────┘  │
│  At least 3 characters.                      │
│                                              │
│  Industry (optional)                         │
│  ┌────────────────────────────────────────┐  │
│  │                                        │  │
│  └────────────────────────────────────────┘  │
│                                              │
│  ☑ I authorize Claude Code to create a       │
│     Personal Access Token on my behalf.      │
│                                              │
│        [ Create org & authorize ]            │
└──────────────────────────────────────────────┘
```

Behavior:

1. On page load, if the JWT response shows zero org memberships, render the org-creation form (above) instead of the approve-only card.
2. On submit, the page makes **two sequential calls**:
   - `POST /organization` with `{ company, demographicData }` (existing [signup handler](packages/back-end/src/routers/organizations/organizations.controller.ts:1472)). On success, the back-end auto-creates "My First Project" and the session is now bound to this new org.
   - `POST /cli-auth/approve` with `{ request_id, organization: <new_org_id>, loopback_port }`. Then redirect to the loopback URL.
3. If org creation succeeds but approval fails (network blip, expired `request_id`), the org stays — same outcome as today's signup flow, which already leaves orphan orgs in error cases. Skill detects the failure and prints a recovery path: "Your org was created. Run `gb auth login` again to finish."

**Why inline, not a separate page:**

- One screen, one button click. Brand-new user never has to ask "what now?"
- No new backend endpoint — we compose two existing ones.
- The approval context (`client_name`, `request_id`) stays visible the whole time, so the user understands why they're filling out the form.

**Agent assistance:** `POST /cli-auth/init` accepts an optional `suggested_org_name: string`. The agent can collect this conversationally before triggering the auth flow ("What's your company name?" → "Acme"), pass it to `init`, and the approval page pre-fills the field. User clicks once. This is opportunistic — if the agent doesn't pass it, the user types it.

### No changes to existing PAT UI

The auto-minted token shows up in the existing **Personal Access Tokens** list ([SecretApiKeys.tsx:25](packages/front-end/components/Settings/SecretApiKeys.tsx:25)) with the auto-generated description. Users revoke from there. Zero new revocation UI.

## Agent Skill: `growthbook-onboard`

Lives as a Claude Code skill at `~/.claude/skills/growthbook-onboard/` (or as a plugin). Skill triggers on phrases like "set up GrowthBook", "onboard with GrowthBook", or explicit `/growthbook-onboard`.

### Underlying CLI

Skill shells out to a thin Node CLI distributed as `npx @growthbook/cli`. The CLI does:

```
gb auth login [--api-host=https://api.growthbook.io] [--no-browser]
gb auth status
gb auth logout
gb whoami
gb onboard          # runs the full onboarding sequence
gb onboard --step=<step>
```

`gb auth login` is the loopback flow above. Pseudocode:

```ts
const verifier = randomBytes(32).toString("base64url");
const challenge = sha256(verifier).toString("base64url");

const init = await fetch(`${apiHost}/cli-auth/init`, {
  method: "POST",
  body: JSON.stringify({
    client_name: "Claude Code",
    code_challenge: challenge,
    code_challenge_method: "S256",
  }),
});

const server = http.createServer(/* handle /callback */);
await listen(server, 0, "127.0.0.1");
const port = (server.address() as AddressInfo).port;

const url = new URL(init.approve_url);
url.searchParams.set("port", String(port));
open(url.toString()); // user's default browser

const { code } = await waitForCallback(server); // resolves on GET /callback
const { api_key, organization } = await fetch(`${apiHost}/cli-auth/exchange`, {
  method: "POST",
  body: JSON.stringify({
    request_id: init.request_id,
    exchange_code: code,
    code_verifier: verifier,
  }),
});

await keytar.setPassword("growthbook", "api_key", api_key);
await keytar.setPassword("growthbook", "org_id", organization);
console.log(`✓ Signed in. Token saved to keychain. Org: ${organization}`);
```

`--no-browser` falls back to printing the URL.

### Skill responsibilities (orchestration)

After `gb auth login` succeeds, the skill:

1. Calls `GET /v1/projects` to see existing state.
2. If empty: prompts user for project name, calls `POST /v1/projects`.
3. Checks `GET /v1/environments`; creates `production` if missing.
4. Walks the user through creating their first SDK Connection (`POST /v1/sdk-connections`), printing the client key and matching snippet for their chosen language.
5. Optional: data source setup. If the user wants analytics, walks them through `POST /v1/data-sources` (gated on the new endpoint landing) or directs them to the UI.
6. Creates a sample feature flag (`POST /v1/features`) so they have something to evaluate immediately.

Each step is a separate skill instruction so Claude Code can re-run a single step idempotently.

### Token storage

- macOS: Keychain via `keytar`.
- Linux: libsecret via `keytar` (fallback: `~/.growthbook/credentials` with mode 0600).
- Windows: Credential Manager via `keytar`.
- Env var override: `GB_API_KEY` always takes precedence (for CI / containers).

## Open questions / decisions to confirm before build

1. **Should `/cli-auth/init` require _any_ identifying signal?** Right now it's fully unauthenticated. That's fine because nothing happens until a logged-in human approves — but it does let anyone create dangling `cli_auth_requests`. Cheap to mitigate with the 10/min IP rate limit + 10-min TTL. **Recommend: ship without auth on init.**
2. **Loopback HTTP vs HTTPS.** Standard practice is HTTP on loopback (the network never leaves the machine). Browsers allow this. **Recommend: HTTP.**
3. **What if the user has zero orgs (brand-new signup, no org created yet)?** Resolved — see "Zero-org case" section below.
4. **PAT scoping.** v1 = user role inheritance. v2 candidate = let approval page show "scoped PAT (read-only / publish only / etc.)" with a real scope system. Out of scope for this design.
5. **Telemetry.** Do we want to log which client_names are used (Claude Code vs other agents) so we know who's calling? **Recommend: yes, on `cliAuth.approve` audit event.**
6. **Revocation UX.** Existing PAT list shows auto-minted tokens by description. Should we add a filter / icon for "created via CLI" so users know what to revoke when uninstalling an agent? **Recommend: not v1. The description is enough.**
7. **MCP integration.** Once `gb auth login` lands, should the MCP docs and any future `growthbook mcp` command call it automatically the first time? **Recommend: yes, but as a separate PR after this lands.**

## Rollout

- **PR 1:** Backend — `cli-auth` router + model + tests. Behind a feature flag (`cliAuthEnabled`) for safety; Cloud-only default.
- **PR 2:** Front-end — `/cli-auth` page + approval flow.
- **PR 3:** Public `POST /v1/data-sources` (gap closer, independently useful).
- **PR 4:** `@growthbook/cli` package — initial publish with `auth login`, `whoami`, `logout`.
- **PR 5:** Claude Code skill that uses the CLI for orchestrated onboarding.

PR 1+2 are the minimum viable bootstrap — even without the skill, customers could `npx @growthbook/cli auth login` and have a token within 30 seconds.

## Files we'll touch

| What             | Path                                                                      |
| ---------------- | ------------------------------------------------------------------------- |
| New router       | `packages/back-end/src/routers/cli-auth/cli-auth.router.ts` (new)         |
| New controller   | `packages/back-end/src/routers/cli-auth/cli-auth.controller.ts` (new)     |
| New model        | `packages/back-end/src/models/CliAuthRequestModel.ts` (new)               |
| New validator    | `packages/shared/src/validators/cli-auth.ts` (new)                        |
| Mount router     | `packages/back-end/src/app.ts`                                            |
| New page         | `packages/front-end/pages/cli-auth/index.tsx` (new)                       |
| Audit event      | `packages/back-end/src/types/Audit.ts` (add `cliAuth.approve`)            |
| MCP docs         | `docs/docs/integrations/mcp.mdx` (mention `gb auth login` as alternative) |
| Data source REST | `packages/back-end/src/api/data-sources/*.ts` (new — gap closer)          |
| CLI package      | `packages/cli/` (new workspace package)                                   |
| Skill            | external (Claude plugin / `~/.claude/skills/`)                            |

## Pre-prod hardening checklist

These are NOT in the POC, but must land before we route real customer traffic. Tracked here so they don't get lost.

### Launch blockers (must fix before prod)

- [ ] **User-code matching to defeat local-process phishing.** CLI prints a 4-char code (e.g. `WXYZ`); approval page displays the same code; user must visually verify before approving. Applies to both loopback and device-code flows.
- [ ] **Device Code Grant as a co-equal flow** (not v1.1). Auto-fallback when no display / SSH / container detected. Reuses the user-code primitive above.
- [ ] **Defer PAT minting from `/approve` to `/exchange`.** `/approve` only records intent + binds the request to user/org. PAT is created inside `/exchange` so a dead loopback listener can't leave orphan tokens in users' accounts.
- [ ] **Audit logging on ALL PAT/key creation paths** (existing UI path included). `ApiKeyModel` doesn't `insertAudit` today — fix at the model level so CLI and UI both get coverage.
- [ ] **`/cli-auth/approve` must require Bearer JWT**, not just cookie auth. Use the standard `processJWT` middleware. Otherwise the missing `sameSite` on cookies ([cookie.ts:14](packages/back-end/src/util/cookie.ts:14)) becomes a CSRF foothold.
- [ ] **Respect `enforceSSO` on CLI-minted PATs.** Block PAT creation via `/cli-auth/*` if the user's org has `enforceSSO=true`. (Existing UI PATs untouched — separate decision.)

### v1 polish (before public announcement)

- [ ] **Replace previous CLI tokens** with matching `client_name + hostname` on approve. Surface on approval page: "This will replace your existing Claude Code token on this machine." Never silently.
- [ ] **Approval page headers**: `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`.
- [ ] **Per-`request_id` brute-force protection** on `/cli-auth/exchange`. 3 wrong attempts → request invalidated.
- [ ] **Telemetry sanitization** of `client_name` (`[a-zA-Z0-9 _.-]{1,64}`).
- [ ] **PAT description length** verified against validator + truncated if needed.
- [ ] **Logging hygiene** — no `code_verifier`, `exchange_code`, or plaintext `api_key` in `logger.info` even on error paths.
- [ ] **TOS acknowledgment** on the inline org-creation form, matching the existing signup UI.
- [ ] **Permission warning in skill** if minted PAT inherits `readonly` / `noaccess` role.

### To verify before writing PR 1

- [ ] Length limit on PAT `description` validator.
- [ ] Where existing signup UI renders ToS/Privacy acknowledgment.
- [ ] `/auth/refresh` preserves a return URL through SSO callback so `/cli-auth?req=...` survives the round-trip.
- [ ] Feature-flag mechanism for `cliAuthEnabled` (existing GB feature flag system vs env var).

## Out of scope but worth tracking

- Self-hosted: same protocol works, but the CLI needs a `--api-host` and the approve page is on the customer's domain. Mostly a config / docs problem.
- Token-bound device identity (mTLS, attestation) — overkill for v1.
- A separate "agent" key type with narrower default scope than user PATs — better story long-term but requires a real scope system first.
