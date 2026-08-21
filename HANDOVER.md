# Handover — AI-generated Analytics dashboards

Untracked scratch file. Delete when you're done with it.

## Goal

Let a user ask the Product Analytics AI chat for a dashboard ("build me a
dashboard tracking @Revenue and @Signups for the last 7 days vs the prior 7"),
and get back a **live, laid-out dashboard preview** in the chat with a Save
button — rather than a pile of loose chart cards.

## State

Branch `nh/Support-AI-generated-dashboard`, two commits in:

- `caf5bd96e` Support AI generated dashboard
- `90ad45c43` Clean up the dashboard view a bit

**Uncommitted** (6 files, ~315 insertions) — the most recent round of fixes:
the stale-tile/disabled-Update fix, the dashboard-wide Compare toggle, and
removal of the redundant title input.

Green as of handover: type-check all packages, prettier, eslint on changed
files. Tests: shared 2492, front-end 64 files / 1040, back-end
`test/agent` + `test/enterprise` 135.

## The flow, end to end

1. User types in the PA chat (or the PA empty state, which stashes the message
   and hands off). `/dashboards` is available as a slash command there.
2. The **product-analytics agent** ([product-analytics-agent.ts](packages/back-end/src/enterprise/services/product-analytics-agent.ts))
   loads the `dashboards` skill, gathers metrics via the PA discovery
   endpoints, and calls **one** `proposeDashboard` tool with `{ title,
globalControls?, comparison?, blocks[] }`. Blocks carry only a `config` and
   a coarse `sizeHint`.
3. [`buildDashboardDraft`](packages/back-end/src/enterprise/services/dashboard-proposal.ts)
   runs every exploration server-side (in parallel), attaches the analysis ids,
   enrolls blocks in the date control, and packs the 24-col grid via
   `packDashboardBlocks`. Returns a `draft` in the tool result.
4. [`ChatMessageList`](packages/front-end/enterprise/components/ProductAnalytics/AIChat/ChatMessageList.tsx)
   spots the `proposeDashboard` result and renders
   [`DashboardPreviewBubble`](packages/front-end/enterprise/components/ProductAnalytics/AIChat/DashboardPreviewBubble.tsx),
   which builds a temporary `DashboardInterface` (`id: "new"`) and renders the
   real `DashboardEditor` read-only-content / arrangeable-layout.
5. User adjusts layout, filters, sharing; clicks Save → `POST /dashboards`
   (internal API), or `PUT` when the draft carries a `dashboardId`.

## Non-obvious constraints (the expensive-to-rediscover list)

**Dashboard CRUD is `/api/v1/dashboards`, not v2.** I wrote v2 throughout the
skill first; every call would have 404'd. A guard test now catches this
(see below).

**An exploration block with an empty `explorerAnalysisId` renders blank
forever.** `updateDashboardExplorations` skips blocks whose id is
`.length === 0` ([dashboards.ts:376](packages/back-end/src/enterprise/services/dashboards.ts:376))
and nothing else populates it. This is why the server runs the queries.

**The "Global controls changed, click Update" banner** comes from
`hasStaleDashboardDateResults` in `ProductAnalyticsExplorerBlock`: it compares
the _effective_ config (block config + dashboard date control) against the
config the exploration was **queried** with — date range plus the date
dimension's granularity. So the draft builder must enroll the block _and_
query `getEffectiveExplorationConfig` of the enrolled block. Querying the raw
config leaves every tile stale on first render.

**`globalControlSettings` is omitted from the propose schema on purpose.**
Enrollment is decided when the draft is built. Letting the model set it
independently is exactly how a tile ends up enrolled in a date control it was
never queried against.

**Update is disabled for an unsaved dashboard** unless
`updateTemporaryDashboardResults` is passed
([DashboardUpdateDisplay.tsx:197](packages/front-end/enterprise/components/Dashboards/DashboardEditor/DashboardUpdateDisplay.tsx:197)).
That callback is also what makes the date filter work at all.

**`DashboardGlobalControlsBar` hides the Compare toggle** unless
`onDashboardComparisonChange` is passed (`showCompare={!!...}`). It also owns
the decision between auto-refreshing and marking tiles stale — so don't
refresh from `onGlobalControlsChange` too, or every query runs twice.

**Grid drag requires `isEditing`,** and so did the drag handle. Hence the new
opt-in `allowLayoutEditing` prop threaded through `DashboardEditor` →
`DashboardGrid` → `DashboardBlock`. Defaults off; the dashboard pages are
unchanged.

**Unsaved blocks have no `id`,** so their RGL key is `__staged_block_<i>__`
(`getGridKeyForBlock`). Matching layout items on `block.id` silently drops
every drag.

**`DashboardSnapshotProvider` already skips its fetch for `id === "new"`,** and
exploration tiles fetch their own analysis by id — which is why an unsaved
dashboard renders at all.

**`apiCreateDashboardBody` has no `comparison` field.** The preview saves via
the _internal_ `/dashboards` API, whose `createDashboardBody` does. Don't
switch the save to REST v2 without checking this.

**`metric-experiments` rejects `dateRange`** — it filters on phase dates via
`startDateRange` / `endDateRange`, and ignores the dashboard date filter.

**Agent tool split.** Only the PA agent has `proposeDashboard`. The site-wide
assistant panel does not and cannot render a preview, so `dashboards` is a
**surface-scoped** skill: excluded from the panel's `/` menu, its prompt index,
and its `resolveSkill` (`SURFACE_SCOPED_SKILL_DOMAINS` in
[skills.ts](packages/back-end/src/agent/skills.ts)). The panel tells the user
to use the Analytics chat instead.

**`SkillItem.label` must stay the skill id.** Tiptap's `renderText` turns it
into the `/token` text, and the chat log restyles a command by searching the
message for `/${storedSkillId}`. `title` (derived on the FE by
`skillDisplayName`) is display-only. The `/` menu shows **domain routers only**
— the router body routes to leaves.

## Things I built that didn't exist before

- **`GET /product-analytics/search`, `GET /columns`, `POST /column-values`** —
  the PA skill documented these but they were never built, so the general agent
  couldn't discover metrics at all. Extracted the PA agent's tool
  implementations into
  [product-analytics-discovery.ts](packages/back-end/src/enterprise/services/product-analytics-discovery.ts)
  so both share one implementation.
- **`packDashboardBlocks`** ([autoLayout.ts](packages/shared/src/enterprise/dashboards/autoLayout.ts))
  — deterministic grid packing from `small`/`medium`/`full`. `small` is 8 cols
  (three across), _not_ 6, because `DEFAULT_BLOCK_SIZE_BY_TYPE` sets `minW: 8`
  on exploration blocks; a 6-wide block saves fine then snaps to 8 on first
  drag. A four-across KPI row needs those minimums lowered first.
- **Two guard tests worth keeping.** `test/agent/skill-endpoints.test.ts`
  asserts every `/api/vN/...` path in every skill resolves to a registered
  route (route-aware, so `revisions/new` matches `revisions/:version`). It
  caught the v1/v2 bug and a phantom endpoint. `test/agent/skills.test.ts` also
  checks `loadSkill` cross-references and that every leaf appears in its
  router.
- **Optional `summary` on `callApi`** so a gated write shows something readable
  on the confirmation card instead of just `POST /api/v1/dashboards`.

## Open / not verified

- **Nothing has been run against a live warehouse.** The single biggest
  unknown is **prompt adherence**: does the agent actually reach for
  `proposeDashboard` instead of falling back to `runExploration`? The prompt and
  skill forbid the latter in several places, but that's not something code can
  settle. The original bug report was exactly this failure.
- **The Compare toggle's re-query path is unobserved.** It goes through
  `useExploreData` with `cache: "never"`.
- **Update is correctly disabled on a fresh preview** (nothing is stale). It
  enables once a filter changes. If you'd rather it always be clickable as a
  manual "re-run everything", that's a small change to how `needsUpdate` is
  passed — I didn't want it to look actionable while being a no-op.
- **`sql-explorer` is not available via `proposeDashboard`** (needs an existing
  saved query).
- **Per-experiment blocks stay out of Analytics dashboards** by decision
  (`experiment-metric`, `-dimension`, `-time-series`, `-metadata`, `-traffic`).
  The four aggregate experimentation blocks are supported.
- The preview's sharing control is a two-state button (Private / Visible to
  organization). Project and auto-refresh are _not_ editable there yet, though
  the skill tells the agent not to ask about them on the grounds that they are.

## Verify

```bash
pnpm type-check && pnpm pretty:check
pnpm --filter shared test
pnpm --filter front-end test
pnpm --filter back-end test test/agent test/enterprise
```

End to end, in the PA chat: `/dashboards` then "build me a dashboard with
@SomeMetric for the last 7 days vs the prior 7". Expect **one**
`proposeDashboard` call, no loose chart cards, a full-width preview with tiles
that render data (not "click Update"), a working Compare toggle in the date
picker, and Save landing you on the new dashboard.

## Environment traps

- **`packages/shared/dist` shadows `src` for front-end tests.** A stale one
  produces confusing `X is not a function` errors from `shared` (I hit
  `isRampScheduleServing`). Fix: `pnpm --filter shared build`. Anything that
  runs `generate-openapi` rebuilds it, so a later rebase can leave it stale.
- **`test/api/*` is flaky under parallel load.** Across four full back-end runs
  I saw four _different_ unrelated failures there (two different
  `permission-matrix-revision-entities` tests, then `attributes`), each passing
  in isolation. They share an in-process app + Mongo. Don't chase these; re-run
  the single file to confirm.
- Two pre-existing eslint errors in
  `DashboardEditor/DashboardBlock/index.tsx` (a Radix `Text` import and a
  `size="legacy"`). Confirmed against HEAD — not from this work.
