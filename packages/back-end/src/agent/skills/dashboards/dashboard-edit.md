---
name: dashboard-edit
description: Change an Analytics dashboard — add or remove a chart, swap a metric, change the timeframe, rename it. Use when the user asks to "add a chart to this dashboard", "remove that block", "change the dashboard to last 90 days", "rename this dashboard", @-mentions a dashboard by name, or refers to "this dashboard" on a /product-analytics/dashboards/* page. For building one from scratch, use dashboard-create.
---

# dashboard-edit

Read the dashboard, apply the change, and re-propose the whole thing. The user
gets a fresh preview with a Save button, exactly as when it was created.

Editing goes through you, not the preview: the user can move tiles and change
filters there, but adding, removing, or reconfiguring a chart is a prompt.

## Workflow

Step 1 is the same on either surface (see the `dashboards` skill). With
`proposeDashboard`, follow steps 2–4; without it, follow
`<editing_without_a_preview>` instead.

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
`loadSkill('dashboard-create')` and read its `<blocks>`, `<config_schema>`, and
`<layout>` sections rather than guessing.

<editing_without_a_preview>
For the site-wide assistant, which has no `proposeDashboard`. You write the
change straight to the dashboard and then send the user to look at it.

1. **Run a query for every chart block you add or reconfigure.** A chart block
   renders from an `explorerAnalysisId`, and a block saved without one renders
   blank forever — nothing fills it in later. Post the block's config to the
   endpoint matching its type:

   ```json
   {
     "method": "POST",
     "path": "/api/v1/product-analytics/metric-exploration",
     "body": { "type": "metric", "datasource": "ds_abc", "...": "the config" }
   }
   ```

   `/fact-table-exploration`, `/data-source-exploration`, and
   `/funnel-exploration` are the other three. The body **is** the config — no
   wrapper. Take `exploration.id` from the response and set it as the block's
   `explorerAnalysisId`. These are reads, so they are not gated; you will not be
   asked to confirm them.

   Blocks you are not touching keep the `explorerAnalysisId` they already have.
   Markdown and experimentation blocks need no query at all.

2. **Write the dashboard**, with the complete block list — a partial list drops
   every block you left out:

   ```json
   {
     "method": "PUT",
     "path": "/api/v1/dashboards/dash_abc123",
     "summary": "Add a Signups over time chart to the Growth KPIs dashboard",
     "body": { "blocks": ["...the full revised list..."] }
   }
   ```

   **The body is strict. Do not echo back what `GET` returned.** It accepts only
   `title`, `projects`, `editLevel`, `shareLevel`, `enableAutoUpdates`,
   `updateSchedule`, `globalControls`, `comparison`, and `blocks`. Sending the
   dashboard's own `organization`, `id`, `uid`, `userId`, `dateCreated`, or
   `dateUpdated` fails the whole request with
   `Unrecognized key: "<name>"`.

   **Every chart block needs an `explorerAnalysisId`** — the one it already had,
   or the one you got from step 1. A chart block without it fails with
   `[blocks.N] Invalid input`, which does not name the missing field. Markdown
   and experimentation blocks need none.

   **A brand-new block has no `id`, `uid`, or `organization` — omit all three**
   and the server assigns them. Never invent them: supply all three and they are
   stored verbatim, leaving a block with an id nothing else can resolve.

   Carry each existing block's `layout` through so the grid does not rearrange
   itself. Leave `layout` off a brand-new block and it takes a default size.

   Compare-to-previous-period is `comparison` at the top level:
   `{ "enabled": true, "mode": "previousPeriod" }`, or `{ "enabled": false }` to
   turn it off. It overrides any per-block `comparison`.

   This is a write, so the user confirms it — the `summary` is the only thing
   they read before approving, so name the actual change in their terms.

3. **Send them to it.** End with a link:
   `[Growth KPIs](/product-analytics/dashboards/dash_abc123)`. The panel opens
   it in place, so they see the change land.

If the change needs a new chart and you cannot build a valid config for it, say
so and offer `openAnalyticsChat` instead of saving something broken.
</editing_without_a_preview>

## Guardrails

- **Always pass the full block list.** A proposal replaces the dashboard's
  blocks; sending only the new one drops the rest.
- **Always pass `dashboardId`** when the dashboard already exists. Without it the
  user ends up with a duplicate.
- **Carry `title`, `projects`, and `globalControls` through** unless the user
  changed them.
- **The never-save rule inverts without `proposeDashboard`.** On the site-wide
  panel, writing to the dashboards API is the only way the change reaches them.
- **Confirm before removing a block.** Say which tile is going.

## Endpoints used

- `GET /api/v1/dashboards` — list dashboards
- `GET /api/v1/dashboards/<id>` — read one, including its blocks
- `PUT /api/v1/dashboards/<id>` — write the change (assistant panel only)
- `POST /api/v1/product-analytics/metric-exploration` — run a chart and get its
  analysis id (assistant panel only; same for `/fact-table-exploration`,
  `/data-source-exploration`, and `/funnel-exploration`)
- The product analytics lookup endpoints listed in `dashboard-create`, when the
  change needs a new metric or column

Everything else goes through the `proposeDashboard` tool.

## Handoffs

- `loadSkill('dashboard-create')` — for block shapes, config schema, and layout
  rules, or to build a new dashboard
- `loadSkill('product-analytics')` — if the user just wants to look at a chart
