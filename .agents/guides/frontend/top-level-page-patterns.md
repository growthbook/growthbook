# Top-level page chrome

Scope: pages reached from sidebar links in `packages/front-end/components/Layout/sidebarNav.ts`. Not resource detail pages (`/features/[fid]`, `/experiment/[eid]`, and so on).

This is the working agreement for list and landing chrome. Follow it when you touch a top-level page. Do not invent a fourth header layout.

## Why this exists

The sidebar currently has 8 sections and about 45 destinations. Almost every list page rebuilt its own header: title, description, create button, search, filters, tabs, empty state. The pieces exist (`EmptyState`, `SearchFilters`, `@/ui/Heading`, `@/ui/Button`, `@/ui/Table`, `@/ui/Tabs`). There is no page shell that puts them in a fixed order.

That is why Feature Flags, Experiments, Configs, Fact Tables, and SQL Reports all feel like different products.

## Page types

Every sidebar destination is one of four types. Pick the type first. Chrome follows from it.

| Type | What it is | Sidebar examples | Chrome |
| --- | --- | --- | --- |
| Resource list | A collection the user searches, filters, and adds to | Feature Flags, Experiments, Bandits, Holdouts, Configs, Constants, Metrics, Fact Tables, Data Sources, Dimensions, Segments, SDK Connections, Attributes, Environments, Saved Groups, Namespaces, Dashboards, SQL Reports, Learnings, Presentations, Projects | List shell below |
| Tool | A workspace, not a collection | Product Analytics Explore, Funnel Builder, Power Calculator, Exposure Debugger, Session Replay | No list header. Optional title if the tool has none of its own. Empty state only when a prerequisite is missing (no Data Source, no SDK). |
| Insights | Charts and synthesis over existing work | Home, Insights Dashboard, Timeline, Metric Effects, Metric Correlations | Title + optional filters. No create button unless the page is itself a collection (Presentations). |
| Settings | Forms and admin tables | Settings/* , Import, Slack, Admin, Events, Tags, API Keys, Webhooks, Billing, Usage | Settings already has sticky tabs. Do not add a second page title style. Keep section headings as `Heading`. |

Archetypes is a hybrid: a resource list plus a Simulate tool, split by tabs. That is fine. Put the list chrome inside the list tab, not above both.

## Canonical list shell

Order, top to bottom. Skip a slot when the page has nothing for it. Do not reorder.

1. **Page header.** Title on the left, primary action on the right. Optional one-line description under the title. Optional docs link in the description, not a second callout stacked on the description.
2. **Custom Markdown** (`CustomMarkdown`) if the org configured it. Immediately under the header.
3. **Empty state or body.** If the org has zero of this resource, render `EmptyState` (or `PremiumEmptyState`) and stop. Do not also render search, tabs, or a disabled create button in the header. Put the create action in the empty state, matching the header label.
4. **Status or type tabs** if the collection has a small, stable set of views (All / Running / Drafts / Stopped, or All / Drafts). Not a substitute for search filters.
5. **Toolbar.** Search on the left (`Field` type search, placeholder `Search…`). Facet filters on the right (`SearchFilters` and the page-specific filter file). Same row.
6. **Table** (`@/ui/Table`, `variant="list"`). Cards only when the object is visual (Presentations, Dashboards if the list is thumbnail-based). Default is a table.
7. **Pagination** when the page already paginates. Do not add infinite scroll on one page and numbered pages on the sibling.

Wrapper class: `pagecontents container-fluid` only. Do not mix `contents`, `container`, `p-3`, `pt-4`, or `mt-2 mb-3` on the wrapper. Vertical rhythm belongs on the header and toolbar, not on the page root.

Title: `<Heading as="h1" size="xl">`. Not a raw `<h1>`. Not `size="2xl"`. Not Radix `size="7"` on `@radix-ui/themes` Heading. Not `size="5"`.

The top bar already shows the sidebar name via `PageHead` / `Layout` breadcrumbs. Keep the in-page `h1`. Screen readers and the empty-state jump need it. Do not also pass `PageHead` a breadcrumb that only repeats the same string unless you are on a nested route.

Primary action: one solid `@/ui/Button`. Label `Add {Named Resource}` using the glossary in `ui-copy-style.md` (`Add Feature Flag`, `Add SDK Connection`, `Add Data Source`). Sentence case for the verb. Title Case for the named resource.

When create has two real paths, use a split control: solid `Add` with a dropdown, matching Experiments today. Do not hide the second path in a callout under an empty state if it is a first-class action (importing an experiment is first-class; simulating flags is not).

Permission: disable the button and explain with `Tooltip`, the way Feature Flags already does. Do not hide the button unless the viewer cannot see the resource at all.

## What is inconsistent today

Checked against the sidebar destinations, not detail pages.

### Header markup

| Page | Title | Size / element | Description | Wrapper |
| --- | --- | --- | --- | --- |
| Feature Flags | Feature Flags | raw `h1` | no | `contents pagecontents` |
| Experiments | Experiments | raw `h1` | no | `contents … container-fluid pagecontents` |
| Bandits | Bandits | raw `h1` | no (empty uses a second `h1`) | similar |
| Holdouts | Holdouts | raw `h1` + inline margin 0 | no | mixed |
| Configs | Configs | `Heading` `2xl` | yes | `contents container-fluid pagecontents` + extra mt/mb |
| Constants | Constants | `Heading` `2xl` | yes | same as Configs |
| Saved Groups | Saved Groups | Radix `Heading size="7"` | yes, plus a `HelperText` docs strip | `p-3 container-fluid pagecontents` |
| Attributes | Targeting Attributes | `Heading` `xl` | yes | `contents container-fluid pagecontents` |
| Environments | Environments | `Heading` `xl` | yes | `container-fluid pagecontents` |
| Namespaces | Experiment Namespaces | `Heading` `xl` | yes | `container-fluid pagecontents` |
| Fact Tables | Fact Tables | `Heading` `xl` | no | `pagecontents container-fluid` |
| Metrics | Metrics | raw `h1` | no | `pagecontents container-fluid` |
| Data Sources | Data Sources | raw `h1` | no | mixed |
| Dimensions | User / Experiment / Unit Dimensions | raw `h1` | no | mixed |
| SQL Reports | Custom SQL Reports | raw `h1` | no | `container pagecontents` + Bootstrap flex |
| Dashboards | Product Analytics Dashboards | raw `h1` | | `p-3 container-fluid pagecontents` |
| Learnings | | `Heading` `2xl` | | |
| Timeline | | Radix `Heading size="7"` | | |
| Presentations | | `Heading` `lg` | | |
| Settings General | | `Heading` `size="5"` (Radix) | | |
| SDK Connections | none on the list itself | CTA copy differs inside the list | `container py-4` | |

The newer flag-family pages (Configs, Constants) already look like the target. Attributes, Environments, Namespaces, and Fact Tables are close. Feature Flags and Experiments are the highest-traffic pages and still use raw `h1` plus Bootstrap filter rows.

### Primary action copy

The majority is `Add {Thing}`. Experiments broke that with a dropdown labeled `Add` whose items are `Create New Experiment` and `Import Existing Experiment`. SDK Connections uses `Add SDK Connection` in one branch and `Create New SDK Connection` in another. SQL Reports uses `New SQL Report` on the header and `Start Exploring` in the empty state. Copy guide: buttons are sentence case; named resources stay Title Case. `Add Feature` should be `Add Feature Flag`. `Create New Experiment` should be `Add Experiment` (or `Import experiment` for the secondary path).

### Empty states

Three implementations:

- `EmptyState` (Feature Flags, Experiments, Configs, Constants, Holdouts, Learnings, Presentations, Dashboards)
- `PremiumEmptyState` (Bandits, Holdouts, Dashboards, Learnings)
- Centered `appbox` with an `h2` (Metrics, Fact Tables, SQL Reports, Data Sources)

The `appbox` empties are the ones that still say "Define What Success Looks Like" and skip `EmptyState`. They also use Title Case in body-ish headings that are not `Heading` components.

Almost nobody distinguishes **no resources** from **filters matched nothing**. Experiments with search on and zero rows should say the filters hid everything and offer to clear them. Right now most tables just go blank.

### Tabs vs filters

Experiments, Bandits, and Holdouts: status tabs (All / Running / Drafts / Stopped / Archived) plus search plus `ExperimentSearchFilters`. Archived is a tab that also changes the fetch (`useExperiments(..., hasArchived)`).

Feature Flags, Configs, Constants: All vs Drafts. Archive is a search facet (`is:archived`), not a tab.

Saved Groups: Condition Groups / ID Lists / Drafts. Those are types, not statuses.

Metrics: Individual Metrics / Metric Groups. Types.

Archetypes: Archetypes / Simulate. List vs tool.

Settings: many sticky tabs for form sections.

Three different answers to "where does Archived live" is the one users will notice. Pick one per family and stick to it. Flag family already picked facet. Experiment family already picked tab. Do not mix them on a new page.

Tab persistence also differs: `persistInURL` on `@/ui/Tabs`, hand-rolled hash, `useURLHash`, and `localStorage` (Experiments remembers the last status tab). New pages should use `Tabs` `persistInURL`. Experiments can keep localStorage until someone is already in that file.

### Search

`useSearch` + `Field size="legacy"` + a `*SearchFilters` component is the right stack and is already used on Feature Flags, Experiments, Configs, Constants, Attributes, Fact Tables, Holdouts, Dashboards, Projects, Learnings, Timeline.

Environments, Namespaces, SDK Connections, Data Sources, Presentations, and most Settings tables have no search. Fine when the list is short (Namespaces, Environments). Not fine if the list routinely exceeds a screen (SDK Connections at a large org). Add search when you next touch that list, not as a sweep.

### Docs and onboarding chrome

Stacked, in various combinations: `CustomMarkdown`, `Callout`, `HelperText` with a docs link, `PremiumCallout`, `PremiumTooltip` on the create button, empty-state "View docs", and `DocLink`. Saved Groups has a description **and** a HelperText docs strip. Feature Flags has no description and a Simulate `Callout` under the table. Pick description + optional docs link, or Custom Markdown, or empty-state docs. Not all three.

## Industry comparison

Looked at LaunchDarkly, Statsig, PostHog, Unleash, Amplitude, and Optimizely. The useful overlap is small. Most of the rest is complexity we should not copy.

**Keep / adopt**

- One primary create control on the list. LaunchDarkly: `Create` then Flag. PostHog: `New` then flag type. Unleash: create in the table header. We already have this; we just name it five ways.
- Search plus a Filters control, with active filters visible. LaunchDarkly’s Filters menu, Unleash’s filter chips, Statsig’s any-of / all-of operators. We already have syntax filters and `SearchFilters`. The gap is visual: we do not always show chips for the active facets, and filter-empty is missing.
- Status as a first-class view for experiments. Optimizely filters experiments by status. Our Experiments tabs match that. Do not replace them with a Filters menu.
- URL-synced filter state (PostHog, Unleash). Our `persistInURL` / hash tabs are the start. Search strings already live in localStorage via `useSearch`. Shareable URLs for search would help support and would match PostHog. That is not the first fruit.
- Nav grouping. Statsig folded Holdouts and Autotune under Experiments and put all settings under Settings. We already group that way. Amplitude’s 2024 nav work was a reaction to the same sprawl. Do not add more top-level sections.

**Do not copy**

- LaunchDarkly’s Flags list with a column per open environment, per-environment filters, Display menus, Views, and sidebar shortcuts. That list is a product surface of its own. Ours should stay one table with project scope in the sidebar selector.
- Amplitude’s global `Create > Dashboard` as the only way to create. We already have a plus menu in the top bar. Page-level Add is faster for people who are already on the list. Keep both; do not make the plus menu the only create path.
- Folders / Team Spaces as the default information architecture for flags and experiments. Tags + project + search cover the same job for now.

**Worth stealing later, not now**

- Saved filtered views (LaunchDarkly shortcuts). Useful once chips and URL state exist.
- Column picker (LaunchDarkly Display). Only if a list actually has more columns than a laptop can show.
- Server-side search and pagination (PostHog, Unleash). Needed when a list is capped or slow. Feature Flags already paginates client-side at 20. Do not redesign that in a chrome pass.

## What to consolidate first

These are the low-hanging fruits. Each one is a mechanical pass on top-level list pages. Do not bundle them with a redesign of Explore or Settings.

1. **Extract `ListPageHeader`.** Title, description, docs href, primary action, permission tooltip. Put it in `packages/front-end/components/Layout/` (domain-adjacent, not `@/ui/`, until a second product uses it). Migrate Configs and Constants first (already match). Then Attributes, Environments, Namespaces, Fact Tables, Feature Flags, Experiments.

2. **Normalize the wrapper and the h1.** `pagecontents container-fluid` + `Heading as="h1" size="xl"`. Delete raw `h1` and Radix `size="7"` on these pages.

3. **Normalize Add labels** to the copy glossary. `Add Feature Flag`, `Add Experiment`, `Add Bandit`, `Add Holdout`, `Add Config`, `Add Constant`, `Add SDK Connection`. Empty-state buttons use the same string as the header.

4. **Replace leftover `appbox` empties** (Metrics, Fact Tables, SQL Reports) with `EmptyState`. Keep the illustrations. Title Case for the `EmptyState` title. Sentence case for the description.

5. **Filter-empty.** When `isFiltered && items.length === 0 && hasAnyResources`, show a short empty inside the table area: "No {resources} match this search" and a control that clears search. Do not reuse the first-run `EmptyState`.

6. **One docs slot.** If the page has a description, put the docs link there. Drop the extra `HelperText` or info `Callout` that only repeats it (Saved Groups, Feature Flags Simulate callout can stay because it points at a different tool).

Leave Settings, Home, and Product Analytics Explore alone in this pass. They are not lists.

## What not to do in the chrome pass

- Do not collapse Feature Flags / Configs / Constants into one table. The flag-family split is intentional (`flag-family-authority.md`).
- Do not move Archived from tabs to facets on Experiments just to match Configs.
- Do not add a Display / column picker.
- Do not add sidebar saved views.
- Do not restyle the sidebar in the same change.
- Do not migrate Bootstrap inside a list table "while you are there" unless the file is already in the diff for header work.

## Checklist for a new top-level list

- [ ] Type is Resource list, Tool, Insights, or Settings
- [ ] Wrapper is `pagecontents container-fluid`
- [ ] Title is `Heading as="h1" size="xl"`
- [ ] Primary action is `Add {Named Resource}` or a split Add
- [ ] Zero-item state uses `EmptyState` / `PremiumEmptyState`
- [ ] Filter-empty is a different, smaller message
- [ ] Search + `SearchFilters` if the list can grow past one screen
- [ ] Tabs only for a small stable view set; `persistInURL`
- [ ] At most one docs treatment besides Custom Markdown
