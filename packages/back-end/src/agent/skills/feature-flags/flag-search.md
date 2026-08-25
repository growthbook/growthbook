---
name: flag-search
description: Search, list, and audit GrowthBook feature flags. Use when the user asks "what flags do we have", "find flags tagged payments", "list flags in project X", "which flags are stale", "find flags owned by bryce@company.com", "show me all disabled flags in production", "audit our flags", "find flags with no rules", or "what can we clean up". Read-only — for actually removing flags, use flag-cleanup. For inspecting what depends on a specific flag, use flag-graph. For adding or changing rules, use flag-targeting or flag-rules.
---

# flag-search

Search, list, and audit GrowthBook feature flags. Three jobs share this skill: broad inventory listing, filtered search by criteria, and stale-flag auditing for cleanup candidates.

Read-only — this skill never writes.

Use the `callApi` tool for every REST request.

## Workflow

Pick the path that matches the user's request.

### Path A — Full inventory ("what flags do we have?")

Start with the lightweight key list:

```json
{ "method": "GET", "path": "/api/v2/feature-keys" }
```

Returns every flag ID as a string array — no pagination, cheapest call. Surface the count and group by prefix if patterns emerge (`checkout-*`, `payments-*`, `infra-*`).

If the user wants details on the full set or a subset, paginate:

```json
{ "method": "GET", "path": "/api/v2/features", "query": { "limit": "100" } }
```

```json
{
  "method": "GET",
  "path": "/api/v2/features",
  "query": { "limit": "100", "offset": "100" }
}
```

100 per page is the cap. Loop with `offset` until the returned count is below 100.

Group output by project if the org uses projects. Flag keys that look like orphaned test/debug entries (`test-`, `temp-`, `debug-`, `delete-me`).

### Path B — Search by criteria

Use the `/api/v2/features` list endpoint with query params to narrow results. `tag`, `owner`, and `valueType` take comma-separated values (ORed within a param; separate params AND together), and `sortBy`/`sortOrder` control ordering:

```json
{
  "method": "GET",
  "path": "/api/v2/features",
  "query": { "projectId": "<project-id>", "tag": "payments,checkout" }
}
```

```json
{
  "method": "GET",
  "path": "/api/v2/features",
  "query": {
    "owner": "bryce@company.com",
    "sortBy": "dateUpdated",
    "sortOrder": "desc"
  }
}
```

Not everything the app's search box supports has an API filter. No list filter exists for: environment on/off state, rule shape (no rules, prerequisites, saved groups, linked experiments, temp rollouts), free-text description search, or created/updated date ranges — for those, fetch the (param-narrowed) set and filter client-side from the response fields. Staleness, drafts, and dependency lookups are better served by their dedicated endpoints (Path C below, `flag-revisions`, `flag-graph`) than by client-side filtering.

Common searches:

| Request                       | Approach                                                                 |
| ----------------------------- | ------------------------------------------------------------------------ |
| "Flags owned by X"            | `GET /api/v2/features?owner=<email or u_...>`                            |
| "Boolean flags"               | `GET /api/v2/features?valueType=boolean`                                 |
| "Flags tagged payments"       | `GET /api/v2/features?tag=payments`                                      |
| "Flags in project Y"          | Resolve project name → ID, then `GET /api/v2/features?projectId=<id>`    |
| "Recently changed flags"      | `GET /api/v2/features?sortBy=dateUpdated&sortOrder=desc`                 |
| "Flags backed by config X"    | `GET /api/v2/features?baseConfig=<config-key>`                           |
| "Archived flags too"          | Add `archived=true` (default excludes archived)                          |
| "Flags enabled in production" | Fetch (narrowed) set, filter on `environmentSettings.production.enabled` |
| "Flags with no rules"         | Fetch (narrowed) set, filter on `rules.length === 0`                     |

When a search needs client-side filtering on a large org, narrow with API params first, then paginate through the remainder.

### Path C — Stale flag audit ("what can we clean up?")

GrowthBook defines a flag as stale when **both** conditions hold: (a) no updates for two weeks, and (b) either no active environments or all rules route 100% of traffic to a single variation.

**Step C-1: Get the flag IDs to audit.**

Either from the user's explicit list, from a codebase grep, or by pulling all IDs:

```json
{ "method": "GET", "path": "/api/v2/feature-keys" }
```

**Step C-2: Run the staleness check.**

The endpoint requires an explicit ID list (no "find all stale" shortcut):

```json
{
  "method": "GET",
  "path": "/api/v2/stale-features",
  "query": { "ids": "flag-a,flag-b,flag-c" }
}
```

**Step C-3: Interpret the results.**

Each flag gets a `staleReason`:

| `staleReason`       | Meaning                                                                          | Action                                                                  |
| ------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `rules-one-sided`   | All rules route 100% of traffic to a single value — looks like a shipped feature | Safe to clean up — inline the winning value                             |
| `no-rules`          | Flag has no rules at all                                                         | Safe to remove if `defaultValue` is already inlined                     |
| `toggled-off`       | Disabled in all environments                                                     | Safe to remove if no longer needed                                      |
| `abandoned-draft`   | Has a draft open with no recent activity                                         | Check the draft; discard or continue                                    |
| `never-stale`       | Explicitly excluded from stale detection                                         | Skip — permanent intentional flag (kill switch, ops toggle)             |
| `recently-updated`  | Updated within the last two weeks                                                | Not stale yet — revisit later                                           |
| `active-draft`      | Has an active draft revision in progress                                         | Someone is working on it — leave alone                                  |
| `has-dependents`    | Other flags list this flag as a prerequisite                                     | Cannot remove safely without updating dependents — use flag-graph first |
| `active-experiment` | Linked to a running experiment                                                   | Stop the experiment first via experiment-stop                           |
| `has-rules`         | Has active rules that aren't one-sided                                           | Still in use                                                            |

**Step C-4: Present the report.**

Group by recommendation:

1. **Cleanup candidates** (`launched`, `unused`, `abandoned`) — with suggested replacement values
2. **Excluded** (`never-stale`) — list separately, don't include in cleanup recommendations
3. **Still active** — skip

Surface the `defaultValue` and winning rule values for candidates — the user needs these to inline before removing.

Do not delete anything. Call `loadSkill('flag-cleanup')` for actual removal.

## Guardrails

- **`/stale-features` requires explicit IDs.** No "find all stale" endpoint exists. Fetch IDs from `/feature-keys` first if the user doesn't provide them.
- **`/feature-keys` is unpaginated; `/features` is paginated (100/page).** Use `/feature-keys` for full ID inventory; `/features` for detail queries.
- **`neverStale: true` flags are excluded from cleanup recommendations.** They appear as `staleReason: "never-stale"` — surface them separately but never suggest removing them.
- **Don't infer staleness yourself.** Use `/stale-features` for the canonical determination; it encodes GrowthBook's own rules and surfaces replacement values you can't compute locally.
- **Owner filter values are userIds or emails.** Emails are resolved to the matching org member; legacy flags that store a raw display name as their owner only match that exact string.
- **Client-side filters on large orgs can be slow.** Rate limit is 60 rpm. Narrow with API params (`tag`, `owner`, `valueType`, `projectId`) before paginating; if still paginating through hundreds of flags, surface progress updates.
- **v2 rules are flat.** Under v2, the `rules` array is top-level on the flag object with `allEnvironments`/`environments` scope per rule — not nested under each environment as in v1.
- **Read-only.** Never POST, PUT, PATCH, or DELETE from this skill. Route to flag-cleanup for removals.

## Endpoints used

- `GET /api/v2/feature-keys` — full ID list, no pagination cap
- `GET /api/v2/features` — paginated list with full configuration. Filters: `projectId`, `tag`, `owner`, `valueType`, `baseConfig`, `archived`, `clientKey` (CSV values ORed within `tag`/`owner`/`valueType`); sorting: `sortBy` (`id`, `dateCreated`, `dateUpdated`) + `sortOrder`
- `GET /api/v2/features/:id` — full configuration for one flag
- `GET /api/v2/stale-features?ids=a,b,c` — staleness audit (requires explicit `ids`)
- `GET /api/v1/projects` — resolve project name to ID for project-scoped searches

## Handoffs

- `loadSkill('flag-graph')` — to trace dependencies for a specific flag (what does it depend on, what depends on it)
- `loadSkill('flag-cleanup')` — to archive or delete cleanup candidates found in Path C
- `loadSkill('flag-targeting')`, `loadSkill('flag-rules')` — to make changes after identifying which flag needs updating
- `loadSkill('flag-revisions')` — to check for open drafts on flags found in the search
