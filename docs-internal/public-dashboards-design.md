# Public (Unauthenticated) Dashboard Sharing — Design

**Status:** In progress (Chunk 1 — data model — complete)
**Author:** msamper
**Goal:** Allow dashboards to be shared via a public URL that anyone can view without authenticating, following the established pattern used by public reports and experiments.

### Decisions

- **Scope (v1):** both experiment-linked and general dashboards.
- **`shareLevel` vocabulary:** keep dashboard vocabulary and add `public` → `published | private | public` (see §2 for why we did _not_ rename to match reports).
- **Premium gate:** reuse the existing `share-product-analytics-dashboards` commercial feature (no new feature constant).

---

## 1. Background

GrowthBook already ships unauthenticated public sharing for two entities:

- **Reports** — `GET /api/report/public/:uid` → `pages/public/r/[r].tsx`
- **Experiments** — `GET /api/experiment/public/:uid` → `pages/public/e/[e].tsx`

Both use the same recipe:

1. A `shareLevel` enum on the model (`"public" | "organization" | "private"` for reports).
2. A route registered in `back-end/src/app.ts` **before** the JWT auth middleware, with permissive CORS (`origin: "*"`, `credentials: false`).
3. Inline authorization in the controller: return `401` unless `shareLevel === "public"`. Auth is never required — the share level _is_ the gate.
4. A public Next.js page that fetches in `getServerSideProps` and renders with `preAuth` / `progressiveAuth` flags.
5. An `ssrData` bundle + `useSSRPolyfills` to stand in for the `DefinitionsContext` an anonymous user can't load.
6. A `shareUrl` (`${appOrigin}/public/r/${uid}`) surfaced only when public.

Dashboards are already partly groomed for this:

- `dashboardInterface.uid` exists, with a comment noting it's reserved for "future sharing/linking capabilities."
- `dashboardInterface.shareLevel` was `"published" | "private"` (where `"published"` means _visible to org members_ — **not** public) and now has `"public"` added (Chunk 1).

### Why dashboards are harder than reports

A report is largely self-contained around one experiment + one snapshot. A dashboard is a grid of heterogeneous **blocks** that reference many entities:

- experiment snapshots (`experiment-metric`, `experiment-dimension`, `experiment-time-series`, `experiment-traffic`)
- experiment metadata (`experiment-description`, `experiment-hypothesis`, `experiment-variation-image`, `experiment-metadata`)
- saved queries with raw SQL + result rows (`sql-explorer`)
- fact metrics + metric analyses (`metric-explorer`)
- product-analytics explorations (`metric-exploration`, `fact-table-exploration`, `data-source-exploration`)
- free text (`markdown`)

The public endpoint must resolve all of that for an anonymous viewer **while bypassing the per-resource org permission checks** — the dashboard's public status becomes the sole authority. This is both the bulk of the work and the main place data could leak.

---

## 2. Data model changes

### `shareLevel` ✅ (Chunk 1, done)

```ts
// shared/src/enterprise/validators/dashboard.ts
export const dashboardShareLevel = z.enum(["published", "private", "public"]);
```

- `private` — owner only.
- `published` — org members with read access (unchanged meaning).
- `public` — anyone with the URL, no auth (new).

**Why not rename to match reports (`public | organization | private`)?** The sibling field `editLevel` was _deliberately_ renamed `organization → published` previously (see `DashboardModel.migrate`). Renaming `shareLevel` to use `organization` would have made the two sibling fields disagree on the same "org-visible" concept and reversed that prior decision. We kept the dashboard vocabulary instead, accepting that `published` and `public` look alike.

**Mitigation for the `published`/`public` collision:** a comment on the enum spells out the distinction and marks every `shareLevel === "public"` check as a public-exposure boundary. No data migration is needed — `public` is additive and opt-in; existing docs keep their meaning.

> `editLevel` is unchanged. Public sharing only concerns _view_ access; editing remains owner/admin-gated.

### `DashboardModel.canRead()`

Extend so a `public` dashboard is readable without an authenticated org member, mirroring how the report/experiment public controllers gate inline. The public **route** does the `shareLevel === "public"` check explicitly rather than relying on `canRead`, because `canRead` runs in an authenticated context. Keep `canRead` for the org-member path.

### Premium gating

Reuse the existing `share-product-analytics-dashboards` commercial feature — no new feature constant. This gate already covers org-internal dashboard sharing; the `public` tier rides on the same entitlement. Enforced in `canCreate`/`canUpdate` (Chunk 2).

---

## 3. Backend: public endpoint

### Route registration (`back-end/src/app.ts`)

Add alongside the existing public routes, before the JWT middleware:

```
GET /api/dashboard/public/:uid   →  dashboardsController.getDashboardPublic
   CORS: origin "*", credentials false
```

Also extend the public image signed-URL endpoint to accept `shareType=dashboard` so images embedded in markdown / variation-image blocks resolve for anonymous viewers (currently `experiment | report`).

### Controller: `getDashboardPublic`

1. Look up dashboard by `uid` (not `id`).
2. If not found → `404`. If `shareLevel !== "public"` → `401` (same as reports/experiments).
3. Build the response:
   - `dashboard` — the doc, redacted (see §5).
   - `ssrData` — the definitions polyfill bundle (see §4).
   - Block result data — either inline (small) or deferred to per-block lazy endpoints (heavy). See §6.
4. Use `dangerous*BypassPermission` accessors to fetch block-referenced resources, since there's no user context. **Every fetched doc passes through an allow-listed serializer before leaving the endpoint** (§5).

---

## 4. The `ssrData` bundle

`ssrData` is the definitions/context polyfill — **not** the block result data. It mirrors `ExperimentReportSSRData` (`shared/types/report.d.ts`) but unioned across all blocks.

```ts
export type DashboardSSRData = {
  // same shape as ExperimentReportSSRData, collected across all blocks
  metrics: Record<string, ExperimentMetricInterface>;
  metricGroups: MetricGroupInterface[];
  factTables: Record<string, FactTableInterface>;
  factMetricSlices: Record<
    string,
    Array<{
      id: string;
      name: string;
      description: string;
      baseMetricId: string;
      sliceLevels: SliceLevelsData[];
      allSliceLevels: string[];
    }>
  >;
  dimensions: DimensionInterface[];
  projects: Record<string, ProjectInterface>;
  settings: OrganizationSettings;
  commercialFeatures?: CommercialFeature[];

  // dashboard-specific label lookups
  experiments: Record<string, Partial<ExperimentInterfaceStringDates>>;
};
```

### How it's populated — walk the blocks

A `generateDashboardSSRData({ context, dashboard })` function, mirroring the existing `generateExperimentReportSSRData` in `back-end/src/services/reports.ts`, collects referenced IDs by iterating `dashboard.blocks`:

| Block type                                                                   | Contributes to `ssrData`                                                            |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `markdown`                                                                   | nothing                                                                             |
| `experiment-*` (description, hypothesis, metadata, traffic, variation-image) | `experiments[experimentId]` + its `projects`                                        |
| `experiment-metric` / `experiment-time-series`                               | above + `metricId`(s) → `metrics`, `metricGroups`, `factTables`, `factMetricSlices` |
| `experiment-dimension`                                                       | above + `dimensionId` → `dimensions`                                                |
| `metric-explorer`                                                            | `factMetricId` → `metrics` + its `factTables`                                       |
| `sql-explorer`                                                               | datasource **name** only (label)                                                    |
| `*-exploration`                                                              | datasource / fact-table **name** only                                               |

Then batch-fetch over the unioned ID sets — the same calls `generateExperimentReportSSRData` already makes (`metricGroups.getAll()`, `getMetricsByIds`, `factMetrics.getByIds`, `getFactTablesByIds`, `findDimensionsByOrganization`, projects).

### Frontend polyfill

`useSSRPolyfills` (`front-end/hooks/useSSRPolyfills.ts`) works almost as-is. Add one accessor — `getExperimentById` — backed by `ssrData.experiments`. Everything else (`getExperimentMetricById`, `getDimensionById`, `getFactTableById`, `getProjectById`, org settings, currency, CI level, p-value, commercial features) is already covered.

---

## 5. Redaction — the critical safety boundary

Public dashboards can expose more raw data than a polished report, so the endpoint must **never serialize raw Mongo docs**. It builds the payload through explicit allow-listed serializers per type. Precedent: `generateExperimentReportSSRData` already `omit`s from every metric:

```
queries, runStarted, analysis, analysisError, table, column,
timestampColumn, conditions, queryFormat
```

Apply the same discipline, plus dashboard-specific concerns:

- **`sql-explorer`** — strip the saved query's **SQL text**. Expose only the column headers + result rows the author chose to display. _This is the single biggest leak vector._
- **metrics / fact tables** — same omit list as reports (table/column/conditions/SQL plumbing).
- **data source** — display name at most; never connection details.
- **experiments** — omit internal fields; keep name, variations, status, hypothesis (match what the public experiment page already exposes).
- **explorations** — result data only, no underlying query definitions.

This per-type allow-list is an enforceable code-review boundary: if a new field must be public, someone has to add it explicitly.

### ⚠️ Pre-existing finding: public reports already leak SQL (TO FILE)

While building the dashboard snapshot serializer we found that `ExperimentSnapshotInterface.settings` embeds raw SQL:

- `settings.queryFilter` — a raw SQL WHERE clause
- `settings.metricSettings[].settings.sql` — each metric's SQL
- `settings.dimensions[].settings.sql` — each dimension's SQL

`getReportPublic` (`controllers/reports.ts`) returns the **whole snapshot** to anyone with a public report URL, so **public report links already expose metric/dimension SQL and query filters to unauthenticated viewers.** This predates the dashboards work and is independent of it — flagged here to file as its own security ticket. (The snapshot's `queries` field is only `QueryPointer[]` = `{ query: <id>, status, name }`, so no SQL there.)

**Dashboard snapshot handling (our decision):** do NOT copy the report precedent. Strip the SQL-bearing fields before returning — blank `settings.queryFilter`, drop `sql` from each `settings.metricSettings[].settings` and `settings.dimensions[].settings` — while keeping `analyses`/results the UI renders. This is a targeted deny-list on the snapshot (not a full allow-list) because allow-listing that ~40-field nested object would be brittle and break results rendering; the SQL fields are enumerated with a comment.

---

## 6. SSR vs. lazy loading (TTFB)

`getServerSideProps` runs before any HTML is sent, so resolving every block server-side raises Time-To-First-Byte and the viewer stares at a blank tab until the slowest block resolves. Some blocks (product-analytics explorations, large query results) are expensive.

**Recommended hybrid:**

- **SSR the shell** — dashboard metadata, grid layout, `<Head>` / og: tags (for link previews), and the `ssrData` definitions bundle.
- **Lazy-load heavy block data** client-side from the public endpoint (or per-block public endpoints), with a per-block loading state. The `ssrData` polyfill is already in hand to render labels while rows stream in.

This keeps the SEO + context benefits of SSR without blocking first paint on the slowest block.

---

## 7. Frontend

- New page `pages/public/d/[d].tsx`, mirroring `pages/public/r/[r].tsx`:
  - `getServerSideProps` fetches `/api/dashboard/public/:uid`, returns `{ dashboard, ssrData }` (+ small inline block data).
  - `preAuth` / `progressiveAuth` flags so anonymous users view and org members get extra affordances ("open in app", private link).
  - `isOrgMember` check identical to the report page.
- Block renderers must accept data from the public payload + `useSSRPolyfills` instead of authenticated hooks. Audit each block component for direct `useDefinitions()` / org-scoped SWR usage and route through the polyfill.
- Share-level control in the dashboard UI (owner/admin only, matching existing `canUpdate` ownership rules). Surface the `shareUrl` when public.

---

## 8. Share URL

Build `${appOrigin}/public/d/${uid}` in the dashboard API serializer, added to the response only when `shareLevel === "public"` — same as `toReportApiInterface` and the experiment service.

---

## 9. Work breakdown & rough effort

| Area                                          | Notes                                              | Effort    |
| --------------------------------------------- | -------------------------------------------------- | --------- |
| `shareLevel` enum + migration                 | reconcile `published`→`organization`, add `public` | S         |
| Public route + CORS + `getDashboardPublic`    | mirror report controller                           | S         |
| `generateDashboardSSRData`                    | walk blocks, batch-fetch, union                    | M         |
| Redaction allow-list serializers              | per-type; SQL-explorer is the risk                 | M         |
| Block renderers via polyfill                  | audit each block type for context deps             | M–L       |
| `pages/public/d/[d].tsx` + lazy block loading | hybrid SSR                                         | M         |
| Public image `shareType=dashboard`            | extend existing endpoint                           | S         |
| Share-level UI + shareUrl                     | owner/admin gated                                  | S         |
| Privacy review                                | what's exposed per block type                      | (process) |

**Rough total:** ~1–2 weeks including review. The scaffolding (enum, route, share URL) is a day or two; the bulk is block-data resolution for anonymous viewers, the frontend public renderer, and the data-exposure review.

---

## 10. Open questions

1. ~~Commercial tier for public dashboards~~ — **Resolved:** reuse `share-product-analytics-dashboards`.
2. ~~Experiment-linked vs general dashboards~~ — **Resolved:** both, in v1.
3. Should public dashboards be excluded from auto-update scheduling, or refresh as normal?
4. Rate-limiting / abuse considerations for unauthenticated endpoints (reports/experiments precedent?).
5. Audit logging — do we log public views, or just share-level changes?

---

## Appendix: key reference files

- `back-end/src/app.ts` — public route registration (search `report/public`, `experiment/public`)
- `back-end/src/controllers/reports.ts` — `getReportPublic` (inline `shareLevel` gate)
- `back-end/src/services/reports.ts` — `generateExperimentReportSSRData`
- `front-end/pages/public/r/[r].tsx` — public report page pattern
- `front-end/hooks/useSSRPolyfills.ts` — definitions polyfill
- `shared/types/report.d.ts` — `ExperimentReportSSRData`
- `shared/src/enterprise/validators/dashboard.ts` — dashboard validator + `shareLevel`
- `shared/src/enterprise/validators/dashboard-block.ts` — block discriminated union
- `back-end/src/enterprise/models/DashboardModel.ts` — `canRead` / permission methods
- `back-end/src/routers/dashboards/dashboards.controller.ts` — existing dashboard controllers
