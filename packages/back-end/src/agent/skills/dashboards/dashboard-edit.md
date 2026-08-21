---
name: dashboard-edit
description: Change an Analytics dashboard — add or remove a chart, swap a metric, change the timeframe, rename it. Use when the user asks to "add a chart to this dashboard", "remove that block", "change the dashboard to last 90 days", "rename this dashboard", or refers to "this dashboard" on a /product-analytics/dashboards/* page. For building one from scratch, use dashboard-create.
---

# dashboard-edit

Read the dashboard, apply the change, and re-propose the whole thing. The user
gets a fresh preview with a Save button, exactly as when it was created.

Editing goes through you, not the preview: the user can move tiles and change
filters there, but adding, removing, or reconfiguring a chart is a prompt.

## Workflow

1. **Resolve the dashboard.** From page context
   (`/product-analytics/dashboards/<id>`), or by listing:

   ```json
   { "method": "GET", "path": "/api/v1/dashboards" }
   ```

   If several match what the user described, `askUser` with one option per
   dashboard. Then read it:

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
     "globalControls": { "dateRange": { "predefined": "last90Days" } },
     "blocks": ["...the full revised list..."]
   }
   ```

   `title` and `globalControls` are required on every call — carry the existing
   values through unless the user asked to change them, or you will silently
   revert them.

4. **Stop.** One sentence naming what changed. Do not save it yourself.

If you need the block shapes, the config schema, or the layout rules,
`loadSkill('dashboard-create')` and read its `<blocks>`, `<config_schema>`, and
`<layout>` sections rather than guessing.

## Guardrails

- **Always pass the full block list.** A proposal replaces the dashboard's
  blocks; sending only the new one drops the rest.
- **Always pass `dashboardId`** when the dashboard already exists. Without it the
  user ends up with a duplicate.
- **Carry `title` and `globalControls` through** unless the user changed them.
- **Never save.** No `PUT` or `POST` to the dashboards API — the user saves from
  the preview.
- **Never call `runExploration`.** `proposeDashboard` runs the queries.
- **Confirm before removing a block.** Say which tile is going.
- **Only the Analytics block types.** See the scope section of the `dashboards`
  router.

## Endpoints used

- `GET /api/v1/dashboards` — list dashboards
- `GET /api/v1/dashboards/<id>` — read one, including its blocks
- The product analytics lookup endpoints listed in `dashboard-create`, when the
  change needs a new metric or column

Everything else goes through the `proposeDashboard` tool.

## Handoffs

- `loadSkill('dashboard-create')` — for block shapes, config schema, and layout
  rules, or to build a new dashboard
- `loadSkill('product-analytics')` — if the user just wants to look at a chart
