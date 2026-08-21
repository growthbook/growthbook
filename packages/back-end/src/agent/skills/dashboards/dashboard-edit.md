---
name: dashboard-edit
description: Change an Analytics dashboard that already exists — add or remove a block, retitle it, change its date range, or reconfigure a chart. Use when the user asks to "add a chart to this dashboard", "remove that block", "change the dashboard to last 90 days", "rename this dashboard", or refers to "this dashboard" on a /product-analytics/dashboards/* page. For building one from scratch, use dashboard-create.
---

# dashboard-edit

Modify an existing general (Analytics) dashboard. The update endpoint takes a
partial dashboard, but **`blocks` replaces the entire array** — so always read
the dashboard first and send the full merged list, never just the block you
touched.

Use `callApi` for every REST request. The update call is gated automatically —
issue it directly.

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

   Keep the returned `blocks` array — it is the base for every edit below.

2. **Make the change.** See `<edits>`.

3. **Write it back**, once, with a `summary` describing the change in the user's
   terms:

   ```json
   {
     "method": "PUT",
     "path": "/api/v1/dashboards/<id>",
     "summary": "Add a 'Signups by platform' bar chart to 'Growth KPIs'",
     "body": {
       "blocks": [
         /* the full merged array */
       ]
     }
   }
   ```

   Send only the fields you are changing — but `blocks` must always be complete.

4. **Report back** what changed in one line, and link
   `/product-analytics/dashboards/<id>`.

<edits>
### Add a block

Follow `dashboard-create` steps 3–6 for the new block: find the metric, discover
columns if it needs a breakdown, **run the exploration** to get a real
`explorerAnalysisId`, and give it a `layout`. Then append it to the existing
`blocks` array.

For `layout`, either place it below everything currently on the dashboard —
`y` = the highest existing `y + h` — or pair it beside a block in a row that has
room within the 24 columns. Do not overlap existing blocks. Omitting `layout`
also works: the block lands full-width at the bottom.

If you only need the block types and field shapes, `loadSkill('dashboard-create')`
and read its `<blocks>` and `<layout>` sections rather than guessing.

### Remove a block

Filter it out of `blocks` by its `id` and send the rest. Name what you are
removing before you write, since the data behind it is not recoverable from the
dashboard afterwards.

### Reconfigure a chart

Start from the block's existing `config`, apply the change, and **rerun the
exploration** — a config change with a stale `explorerAnalysisId` leaves the
block rendering the old data. Put the new id and the new config on the block
together.

### Change the dashboard date range or filters

```json
{
  "method": "PUT",
  "path": "/api/v1/dashboards/<id>",
  "summary": "Switch 'Growth KPIs' to the last 90 days",
  "body": {
    "globalControls": {
      "dateRange": { "predefined": "last90Days" },
      "dateGranularity": "auto"
    }
  }
}
```

You do not need to touch the blocks for this — blocks that follow the dashboard
filter pick it up. Two caveats worth telling the user about:

- `metric-experiments` never follows the dashboard date range; it filters on
  phase dates via its own `startDateRange` / `endDateRange`.
- A block a user previously opted out of the filter bar stays opted out. Do not
  flip `globalControlSettings` to force it — that overrides a deliberate choice.

### Rename, or change sharing

```json
{ "body": { "title": "Growth KPIs — EMEA" } }
```

`shareLevel: "published"` makes it visible to the org. Only set it when the user
asks; say plainly that it becomes visible to teammates.
</edits>

## Guardrails

- **`blocks` is a full replacement.** GET first, merge, then PUT. Sending one
  block deletes the rest.
- **Preserve `id` and `uid` on existing blocks.** Send them back exactly as read.
  Dropping them makes the block a new one and loses its identity.
- **Rerun the exploration after any `config` change**, and never write an empty
  `explorerAnalysisId`.
- **One PUT per request.** Batch several changes into one write.
- **Only the Analytics block types.** See the scope section of the `dashboards`
  router; per-experiment result blocks cannot go on these dashboards.
- **Confirm before removing.** Deleting a block is a real loss for the user even
  though the metric survives.
- **Rejected write means stop.** Ask what to change instead of reissuing.

## Endpoints used

- `GET /api/v1/dashboards` — list dashboards
- `GET /api/v1/dashboards/<id>` — read one, including its blocks
- `PUT /api/v1/dashboards/<id>` — update title, sharing, global controls, or blocks
- `DELETE /api/v1/dashboards/<id>` — delete the whole dashboard (only on an
  explicit request; say what is being deleted first)
- The product analytics lookup and exploration endpoints listed in
  `dashboard-create`

## Handoffs

- `loadSkill('dashboard-create')` — for the block catalog, config schema, and
  layout rules, or to build a new dashboard
- `loadSkill('product-analytics')` — if the user just wants to look at a chart
  without saving it
