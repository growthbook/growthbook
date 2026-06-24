---
name: public-dashboards-project
description: Ongoing work to make dashboards publicly shareable (unauthenticated), branch + key decisions
metadata:
  type: project
---

Building unauthenticated public sharing for dashboards (modeled on the existing public report/experiment pattern). Work started 2026-06-16.

- **Branch:** `msamper/public-dashboards` (off `main`).
- **Design doc:** `docs-internal/public-dashboards-design.md` (gitignored/local-only, kept out of the public `docs/` Docusaurus site). Contains a ⚠️ pre-existing security finding TO FILE: `getReportPublic` returns the whole snapshot, so public _report_ links already leak metric/dimension SQL + `settings.queryFilter` to anonymous viewers — independent of this work.

Decisions:

- **shareLevel vocabulary:** kept dashboard vocabulary and added `"public"` → `published | private | public`. Did NOT rename to match reports' `public | organization | private`, because the sibling field `editLevel` was deliberately renamed `organization → published` previously; renaming `shareLevel` would make the siblings disagree. Accepted the `published`/`public` look-alike collision, mitigated with an enum comment marking `=== "public"` as an exposure boundary. `public` is additive/opt-in → no data migration.
- **v1 scope:** both experiment-linked and general dashboards.
- **Premium gate:** reuse existing `share-product-analytics-dashboards` commercial feature (no new constant).

Progress (all pushed to origin as of 2026-06-17):

- Chunk 1: `"public"` added to `dashboardShareLevel`.
- Chunk 2a (backend): `shareLevel: "public"` gated behind `share-product-analytics-dashboards` in `DashboardModel.canCreate/canUpdate`.
- Chunk 2b (UI): "public" option in `DashboardShareModal` + `uid` threaded through `DashboardEditor` (3 render sites) so the public copy-link (`/public/d/:uid`) works.
- Public endpoint `GET /api/dashboard/public/:uid` (in `app.ts` before JWT, permissive CORS): `DashboardModel.dangerousGetByUid` (cross-org, migrate extracted to static `migrateDoc`), `shareLevel === "public"` gate. Returns `{ dashboard, ssrData, blockData }`.
- `generateDashboardSSRData` + `DashboardSSRData` type (definitions/labels polyfill; metric/experiment/project redaction mirrors report SSR). `factMetricSlices` deferred (empty).
- `getPublicDashboardBlockData` + per-type redaction serializers (`redactSnapshotForPublic` etc.) in `enterprise/services/dashboards.ts` — these ARE the block-data auth boundary. 11 unit tests in `test/enterprise/dashboards-public-redaction.test.ts`.

Backend public endpoint COMPLETE. Public page `pages/public/d/[d].tsx` built (preAuth+progressiveAuth, SSR-fetch, useSSRPolyfills, read-only DashboardGrid reused from DashboardEditor). Renderer = `PublicDashboardBlock` (enterprise/components/Dashboards/Public/).

Public page status (all pushed to origin as of 2026-06-18):

- Renders: markdown, sql-explorer (SQL tab hidden via hideSql), experiment-metadata, experiment-traffic. Others (experiment-metric/-dimension/-time-series, metric-explorer, explorations) = placeholder.
- Experiment dashboards publishable: public View access option added to DashboardModal (settings modal, gated on share-product-analytics-dashboards); more-menu "Share" item copies /public/d/:uid public link when shareLevel public (DashboardsTabMoreMenu).
- Bugs fixed while verifying: (a) block title/card chrome missing on public page; (b) runHealthTrafficQuery + analysisSummary added to SSR pick; (c) snapshot fallback to experiment.analysisSummary.snapshotId when block.snapshotId is null (mirrors useDashboardSnapshot defaultSnapshot); (d) useSSRPolyfills.useOrgSettingsSSR now MERGES ssrData.settings under client settings — useOrgSettings() returns a non-empty stub {requireReviews:[]} even anonymous, which made hasCsrSettings always true and discarded ssrData (latent bug affecting all public pages).

DEFERRED redaction gap (TODO): ssrData passes factTables and dimensions through WHOLE in generateDashboardSSRData — FactTableInterface has sql/columns/filters(value=SQL), DimensionInterface has sql. So we strip metric SQL + snapshot-embedded SQL but re-leak fact-table/dimension SQL via ssrData. Inherited verbatim from generateExperimentReportSSRData, so public report/experiment pages have the same leak (separate ticket). Fix: allow-list factTables (id,name,columns — not sql/filters) and dimensions (id,name — drop sql). blockData redaction is solid.

DONE since: (a) lazy-load refactor — public endpoint split into shell `GET /api/dashboard/public/:uid` ({dashboard, ssrData}) + heavy `GET /api/dashboard/public/:uid/blocks` ({blockData}); page SSRs shell only (~3kB, was 173kB) and client-fetches blockData via fetch(getApiHost()+...) with per-block LoadingSpinner (blockDataLoading prop). Fixed Next 128kB warning. (b) metric-result blocks (experiment-metric/-dimension/-time-series) wired — extracted `resolveExperimentBlockMetricIds` into shared/enterprise/dashboards/utils.ts, used by BOTH authed dispatcher (DashboardBlock/index.tsx) and PublicDashboardBlock; generateDashboardSSRData now fetches experiments up front + resolves selector-based block metrics so they land in ssrData.metrics; experiment pick expanded (goalMetrics/secondaryMetrics/guardrailMetrics/metricOverrides/customMetricSlices).

Public page now renders: markdown, sql-explorer, ALL experiment-\* blocks (metadata, traffic, metric, dimension, time-series). Verified traffic live; metric/dimension/time-series type-check but NOT yet runtime-verified (need a dashboard with those blocks, incognito).

Remaining: (1) metric-explorer + product-analytics exploration blocks (still placeholder in PublicDashboardBlock default case). (2) DEFERRED redaction gap above (factTables/dimensions SQL in ssrData). (3) public image signed-URL endpoint → shareType=dashboard. Open Qs: auto-update public dashboards? audit-log public views? empty-results sql block shows blank (no-rows notice was in hidden SQL tab).

STATE: ~6 commits unpushed (last pushed = a25f63236; HEAD = d03b0bfe2). Branch in good shape, all type-checks clean.

Note: lint pre-commit hook re-stages other modified files — commit feature files with explicit paths. Verify public page in INCOGNITO (logged-in masks anonymous-only bugs).
