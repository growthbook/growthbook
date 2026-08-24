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

**Agent tool split.** Only the PA agent has `proposeDashboard`. The panel can
still load both dashboard skills — each one branches on whether that tool is
present. Create hands off via `openAnalyticsChat`; edit writes through REST.
Surface scoping is gone (`SURFACE_SCOPED_SKILL_*` no longer exists).

**`SkillItem.label` must stay the skill id.** Tiptap's `renderText` turns it
into the `/token` text, and the chat log restyles a command by searching the
message for `/${storedSkillId}`. `title` (derived on the FE by
`skillDisplayName`) is display-only. The `/` menu now lists **every** skill;
there are no routers left to route through.

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
  organization). Project and auto-refresh are still not editable there — but the
  agent now settles the project with the user before proposing, so the skill no
  longer claims otherwise. Auto-refresh remains an unasked default.

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

---

## Round 2 — what changed after the handover

Five workstreams, all green on type-check, prettier, eslint, and
shared / front-end / `test/agent` + `test/enterprise`.

**1. Skills are flat.** No more domain/leaf. Every `.md` under `skills/` is a
skill of its own, listed in the `/` menu and in the system-prompt index (~29
entries, up from 5). `SkillKind` is gone from `SkillSummary`; `group` survives
as the directory name and is used only for scoping the PA chat and ordering the
menu. The three `SKILL.md` files kept their conventions, page-context maps, and
guardrails but lost their sub-skill routing tables — those were dead weight once
the leaves became pickable. They still load by name for that background.

**2. The agent settles name and project.** `proposeDashboard` takes `projects`;
it threads through `buildDashboardDraft` into the draft and into the create body.
The preview falls back to the app's project selector only when the agent omitted
it — an explicit `[]` means "every project" and is preserved as a value. The ask
budget in `dashboards/SKILL.md` now names both as no-default slots, asked in one
bundled `askUser`, on the grounds that they are the two things the preview
cannot fix afterwards.

**3. Rehydrated previews re-query.** `useAIChat` now reports
`rehydratedMessageIds` — the ids the conversation was _loaded_ with, populated
only by the mount-time load, never by the remote poll or the end-of-turn resync.
That distinction is the whole trick: every turn ends by re-reading the transcript
from the server, so without it a just-streamed preview and a rehydrated one are
indistinguishable and every propose would double-run its queries.
`DashboardPreviewBubble` takes `refreshOnMount` and re-runs once, guarded by a
ref because `refreshBlocks` changes identity the moment it succeeds. The mount
refresh uses `cache: "preferred"`; user-driven Update stays `cache: "never"`.

**4. `@Dashboard` mentions.** `AIChatMentionType` gained `"dashboard"` (shared
type and `aiChatMentionValidator`). `useMetricMentionItems` is now
`useMentionItems` and `metricTypeLabel` is `mentionTypeLabel`. Dashboards come
from `useDashboards(false)` — Analytics only, since per-experiment dashboards
are out of scope for every dashboard skill. They are never datasource-filtered
and never marked stale; `resolveProductAnalyticsMentions` returns them
untouched. Both agent prompts document what a `dashboard:` entry means.

**5. Cross-surface.** The panel can now load both dashboard skills, which branch
on tool availability:

- **Create** → `openAnalyticsChat`, a new general-agent tool carrying a written
  brief plus mentions. The result rides in the transcript, and
  `AnalyticsHandoffCard` renders a button that stashes the brief into
  `PA_AI_CHAT_INITIAL_MESSAGE_KEY` and pushes to the Analytics chat. Deliberately
  a click, not an automatic navigation — the panel floats over whatever the user
  was doing.
- **Edit** → straight REST. `POST /api/v1/product-analytics/{metric,fact-table,data-source,funnel}-exploration`
  for any new or changed chart (these are already exempt from the mutation gate,
  so no confirmation spam), then a gated `PUT /api/v1/dashboards/<id>` with the
  full block list, then a relative link — `navigateInApp` opens it in place.

### Newly non-obvious

- **A chart block written without `explorerAnalysisId` renders blank forever.**
  Same trap as before, but it now bites the panel's REST edit path too, which is
  why that path runs the exploration endpoints first. The skill says so twice.
- **`apiCreateDashboardBlockInterface` keeps `explorerAnalysisId`** (it omits
  only `id`/`uid`/`organization`), and `layout` is optional — so a REST edit can
  carry existing layouts through and let a new block take a default size.
- **`filterSkillItems` default limit is 50, not 20.** With 29 skills a 20-cap
  silently cut the last directory out of the browse list.

### Still not verified

- Nothing has run against a live warehouse; prompt adherence is still the open
  question, now across two surfaces rather than one.
- The mount refresh fires for every dashboard preview in a reopened thread. With
  `cache: "preferred"` that should be cheap, but a thread with several previews
  has not been watched under a real datasource.
- The panel's REST edit path is untested end to end — in particular whether the
  agent reliably carries the full block list through a `PUT` rather than sending
  only the block it changed. The skill warns about it in two places, which is
  not the same as it working.
