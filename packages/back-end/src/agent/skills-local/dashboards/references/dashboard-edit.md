---
name: dashboard-edit
description: Change an Analytics dashboard — add or remove a chart, swap a metric, change the timeframe, rename it. Use when the user asks to "add a chart to this dashboard", "remove that block", "change the dashboard to last 90 days", "rename this dashboard", @-mentions a dashboard by name, or refers to "this dashboard" on a /product-analytics/dashboards/* page. For building one from scratch, use dashboard-create.
---

# dashboard-edit

Read the dashboard, apply the change, and re-propose the whole thing. The user
gets a fresh preview with an Update button, exactly as when it was created — and
nothing reaches the real dashboard until they press it, so a revision they don't
like is theirs to ignore.

Editing goes through you, not the preview: the user can move tiles and change
filters there, but adding, removing, or reconfiguring a chart is a prompt.

## Workflow

If you have no `proposeDashboard` tool you are on the site-wide panel, and none
of this applies — hand off with `openAnalyticsChat` as the `dashboards` router
says, and stop.

1. **Resolve the dashboard.** In order of authority:
   - An `@`-mention. A `[Referenced by the user: Growth KPIs (dashboard: dash_abc)]`
     line is the user pointing at exactly the dashboard they mean — take that id
     and skip the rest of this step. Do not list or search to second-guess it.
   - Page context, `/product-analytics/dashboards/<id>`.
   - Otherwise, list them:

     ```json
     { "method": "GET", "path": "/api/v1/dashboards" }
     ```

     If several match what the user described, `askUser` with one option per
     dashboard.

   Then read it:

   ```json
   { "method": "GET", "path": "/api/v1/dashboards/<id>" }
   ```

2. **Work out the new block list.** Start from the blocks you just read and apply
   the change — add, remove, reorder, or edit one. Keep the blocks you are not
   touching exactly as they are.

   Translating a saved block back into a proposal is mechanical: keep `type`,
   `title`, `description`, and (for chart blocks) `config`; drop
   `explorerAnalysisId`, `layout`, `id`, `uid`, `organization`, `snapshotId`, and
   `globalControlSettings`. Add a `sizeHint` that matches the width the block
   currently has — `small` for roughly a third, `medium` for about half, `full`
   otherwise — so the layout survives the round trip.

3. **Re-propose**, once, passing `dashboardId` so saving updates the existing
   dashboard instead of creating a second one:

   ```json
   {
     "dashboardId": "dash_abc123",
     "title": "Growth KPIs",
     "projects": ["prj_abc123"],
     "globalControls": { "dateRange": { "predefined": "last90Days" } },
     "blocks": ["...the full revised list..."]
   }
   ```

   `title` and `globalControls` are required on every call — carry the existing
   values through unless the user asked to change them, or you will silently
   revert them. Carry `projects` through from the dashboard you read in step 1
   as well, so the preview shows where it actually lives; do **not** ask about
   the project on an edit, since the dashboard already has one.

4. **Stop.** One sentence naming what changed. Do not save it yourself.

If you need the block shapes, the config schema, or the layout rules,
`loadSkill('dashboards/references/dashboard-create')` and read its `<blocks>`, `<config_schema>`, and
`<layout>` sections rather than guessing.

## Guardrails

- **Always pass the full block list.** A proposal replaces the dashboard's
  blocks; sending only the new one drops the rest.
- **Always pass `dashboardId`.** Without it the preview's button creates a second
  dashboard instead of updating this one.
- **Carry `title`, `projects`, and `globalControls` through** unless the user
  changed them.
- **Never write the dashboard yourself.** The preview's Update button is the only
  thing that writes one, and the user presses it — so a revision they don't want
  costs them nothing.
- **Confirm before removing a block.** Say which tile is going.

## Endpoints and tools used

`callApi` reads the dashboard; nothing writes it:

- `GET /api/v1/dashboards` — list dashboards
- `GET /api/v1/dashboards/<id>` — read one, including its blocks

Then `search`, `getAvailableColumns`, and `getColumnValues` if the change needs a
new metric or column, and `proposeDashboard` to show the revision.

## Handoffs

- `loadSkill('dashboards/references/dashboard-create')` — for block shapes, config schema, and layout
  rules, or to build a new dashboard
- `loadSkill('analytics')` — if the user just wants to look at a chart
