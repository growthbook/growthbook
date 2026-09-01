---
name: dashboard-edit
description: Load, change, or tidy an Analytics dashboard that already exists — pull one up to look at, add or remove a chart, swap a metric, change the timeframe, rename it. Use when the user asks to "load my X dashboard", "pull up this dashboard", "add a chart to this dashboard", "remove that block", "change the dashboard to last 90 days", "rename this dashboard", or @-mentions a dashboard by name. For building one from scratch, use dashboard-create.
---

# dashboard-edit

**Scope: a dashboard that has a `dashboardId`.** The id is the whole test, because
every step below needs one — to read the dashboard, and to make Update land on it
rather than create a second copy. It reaches you three ways: an `@`-mention, a
dashboard you loaded, or the `[The user saved this preview as dashboard <id> …]`
note on a preview the user has just committed.

A preview not yet saved has no id, so revising that belongs to
`dashboard-create`. From the save onwards this file governs, including when
`dashboard-create` is also in your context from earlier in the conversation — its
steps for settling a name and a project have stopped applying.

Rounds of "drop that tile, make it 90 days" follow the router's **revision
round** rules. On this side that means passing `dashboardId` every round, and
omitting `title`, `projects`, `globalControls` or `comparison` keeps the saved
value rather than reverting it.

Read the dashboard, apply the change, and re-propose the whole thing. The user
gets a fresh preview with an Update button; nothing reaches the real dashboard
until they press it.

Editing goes through you, not the preview: the user can move tiles and change
filters there, but adding, removing, or reconfiguring a chart is a prompt.

## Workflow

Check for the `proposeDashboard` tool first. Its absence means you are on the
site-wide panel, where the rest of this file does not apply: hand off with
`openAnalyticsChat` as the `dashboards` router says, and stop.

Note the split: **loading** a dashboard is one call and costs nothing, while
**changing** one re-runs every chart on it. Prefer loading when that is all they
asked for.

1. **Resolve the dashboard.** Take the first of these that applies and move on to
   step 2:
   - **An `@`-mention in the latest message.** A
     `[Referenced by the user: Growth KPIs (dashboard: dash_abc)]` line is the
     user pointing at exactly the dashboard they mean. Use that id as given; it
     outranks everything below, because a fresh mention means they switched.
   - **The one already in play.** Once this conversation has loaded, proposed, or
     edited a dashboard, every follow-up is about that one: take its id from the
     newest `proposeDashboard` draft, or from the `[The user saved this preview
as dashboard <id> …]` note if they saved a preview that had none. "Remove
     the Scaled Impact tile" and "make it 90 days" are about the dashboard on
     screen, so you already know which dashboard it is and whether it is an
     update.
   - **A list, when the conversation has neither.**

     ```json
     { "method": "GET", "path": "/api/v1/dashboards" }
     ```

     One clear match → use it. Several → `askUser` with one option per dashboard.

2. **Show it, when showing is the whole request.** "Load my Growth KPIs
   dashboard", "pull up this dashboard", "let me tidy this up" — one call, no
   block list:

   ```json
   { "dashboardId": "dash_abc123" }
   ```

   The server loads it exactly as saved: same layout, same results, no queries
   re-run. From there the user can drag, resize, and delete tiles themselves and
   press Update. Stop after this call — showing it was the whole request.

3. **Read it, when you do have a change to make.**

   ```json
   { "method": "GET", "path": "/api/v1/dashboards/<id>" }
   ```

   Start from the blocks you just read and apply the change — add, remove,
   reorder, or edit one. Keep the blocks you are not touching exactly as they
   are.

   **`markdown` blocks on a saved dashboard are the user's words.** Carry every
   one through verbatim and in place, however many there are — a saved dashboard
   is free to have more than the single legend a new one starts with.

   **Add or reword a `markdown` block only when the user asks for it.** A
   dashboard with none may well have had one removed on purpose, and the saved
   blocks alone cannot tell you.

   If your change leaves a legend describing a chart that is gone, say so in your
   reply and offer to update it, leaving their words as they are.

   Translating a saved block back into a proposal is mechanical: keep `type`,
   `title`, `description`, and (for chart blocks) `config`; drop
   `explorerAnalysisId`, `layout`, `id`, `uid`, `organization`, `snapshotId`, and
   `globalControlSettings`. The server pairs each proposed block with the saved
   one of the same `type` and `title` and gives it back its position and its
   identity, so **keep titles identical for blocks you are not moving** — a
   retitled block reads as a new one and drops to the bottom of the grid.

   `sizeHint` therefore only matters for blocks you are **adding**; on a block
   carried through it is ignored in favour of the size the user gave it.

4. **Re-propose**, once, passing `dashboardId` so saving updates the existing
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

   `title`, `projects`, `globalControls` and `comparison` are optional here: omit
   one and the saved dashboard's value is kept. Pass one in these two cases:
   - The user asked to change it.
   - The user set it on a preview they have not saved yet. The server falls back
     to the **saved** value, so a timeframe or comparison that exists only on the
     newest draft has to be carried through from that draft to survive.

   The dashboard already has a project, so an edit needs no question about it.

5. **Stop.** One sentence naming what changed. The user presses Update.

For the block shapes, the config schema, or the layout rules, read the `<blocks>`,
`<config_schema>` and `<layout>` sections of
`loadSkill('dashboards/references/dashboard-create')`.

## Guardrails

- **Pass the full block list.** A proposal replaces the dashboard's blocks, so
  the list you send is the dashboard the user gets.
- **Pass `dashboardId`.** It is what makes the preview's button update this
  dashboard rather than create a second one.
- **The preview's Update button is the only thing that writes a dashboard**, and
  the user presses it.
- **Remove the tiles the user asked you to remove, then name them.** The removal
  goes straight into the proposal — the preview is where they confirm it, and
  Update is the only thing that writes. Naming the tiles afterwards lets them see
  it matched what they meant.

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
