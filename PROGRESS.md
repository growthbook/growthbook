# Prototype progress

Newest entry first. Each entry is a snapshot for picking the work back up.

---

## 2026-10-09 — Experiment page redesign + experiments list redesign

### What this is

A design prototype of GrowthBook's experiment pages, built for demos and
design review inside the real app. It covers two screens: the **experiment
details page** (mainly its Setup tab, plus the header and tabs) and the
**experiments list** (`/experiments`). It shows a calmer, design-system-led
layout and a set of restrained interactions: drafts with a save bar, quiet
motion, and neutral styling.

### Where it lives

- Repo/worktree: `gb-redesign-push`, branch
  `prototype/experiment-page-redesign-main`, built on current `origin/main`.
- **Pushed to `origin` up to `5f520e108`.** The later commits (listed under
  "Committed, not yet pushed" below) are local only.
- An older, separate branch, `prototype/experiment-page-redesign`, is built
  on the design-prototypes repo's squashed baseline and must never go to
  `origin`. It is not this branch.

### How to run and view it

- `pnpm dev` from the repo root (see `AGENTS.md`), then:
  - Experiments list: `/experiments`
  - Experiment details: `/experiment/<id>`, opening on the **Setup** tab for
    a draft experiment.
- The redesigned Setup tab shows for non-bandit, non-holdout experiments
  (`useRedesignedSetup` / `showRedesignedChrome` in
  `components/Experiment/TabbedPage/index.tsx`).
- Checks: `pnpm --filter front-end type-check` (judge it by the exit code;
  the output is colourised, so grepping for "error TS" misses errors),
  `pnpm --filter front-end test`, and lint per file with `npx eslint` from
  `packages/front-end`. Running ESLint from a subfolder reports false
  import-order errors.

### What's working

**Experiment details page, Setup tab**
(`components/Experiment/TabbedPage/SetupPage/`)

- **Draft and save bar.** Edits go into a page draft (`setupDraft.ts`) and
  the save bar commits them. The Edit Environments, Edit Targeting and Edit
  Namespace modals say **Apply** and write to that draft instead of saving
  (`EditValuesEnvironmentsModal.tsx`; `EditTargetingModal.tsx` and
  `EditNamespaceModal.tsx`, through `useExperimentTargetingForm.ts`).
- **Timing** (`AnalysisPlan.tsx`):
  - Starts collapsed to a sentence, for example "Starts and ends manually. No
    power analysis attached.", in 12px `--slate-11`, with an always-visible
    **Edit** outline button on the right. Edit opens the controls, and they
    stay open.
  - The opened view has Starts, Ends and **Power** rows. "Ends" defaults to
    **Manually**.
  - When Ends is scheduled, a line under it says what happens at the end,
    from the At End settings: `scheduledEndHelperText()` and
    `scheduledStopPlanFromDraft()` in `setupDraft.ts`, with tests in
    `test/components/experiment/setupDraft.test.ts`.
- **Right rail** (`SetupRail.tsx`): Details and Comments tabs animate. The
  underline grows and fades, and the panel drifts in 8px from the direction
  of travel.
- **Top-level tabs** (`TabbedPage/index.tsx`, `ExperimentHeader.module.scss`
  `.setupTabs`): the same underline handoff and directional content
  entrance.

**Experiments list** (`pages/experiments/index.tsx`,
`components/Experiment/ExperimentsListTable.tsx`)

- Matches the details page's page spacing, title row, tabs, white
  background, and top-bar breadcrumb alignment.
- Toolbar: search with an icon and a clear button; filters with **Status**
  and **Health** always shown and the rest behind **Add Filter**
  (`components/Search/ExperimentSearchFilters.tsx`, `defaultFilters`
  option); and on the right, a row-density and column-settings button group.
- Table:
  - Columns: Experiment, Status, Health, Project, Tags. Owner, Date and
    Result are hidden by default and can be turned on from column settings.
  - Resizable columns, saved per browser (`useTableColumns` /
    `ColumnResizeHandle`, key `experiments-page`).
  - Compact (36px) and comfortable (52px) rows, with an eased change between
    them.
  - Sort arrows (`sortIcons: "arrow"` in `services/search.tsx` /
    `services/search.module.scss`).
  - Rows glide to new positions on a re-sort; tables fade in on tab change.
  - One line per cell, truncated with "…".
  - No outline around the table; a 36px header; a `--slate-2` row hover
    that fades.
- Page-level CSS lives in the page's `<style jsx global>` block, scoped to
  `.contents.experiments`, so other tables are unaffected.
- `ExperimentsListTable` is shared with `/bandits`. Every new behaviour is
  opt-in through props (`showWatchColumn`, `animateSort`, `fixedColumns`,
  `hiddenColumns`, `statusFirst`, `resizableColumnsKey`, `tableColumns`), so
  `/bandits` is unchanged.

**App-wide**

- **Primary buttons** (`ui/Button.tsx`, `ui/Button.module.scss`): every
  violet solid `@/ui/Button` gets a resting shadow, a 1px lift and a grey
  hover shadow, soft drifting **bubbles** on hover, and a 98% press. There's
  no click ring. Off for reduced motion, and off when disabled or loading.
- **Page transition** (`pages/_app.tsx`): View Transitions API. The old
  content fades out over 120ms, and the new content fades in with a 6px rise
  over 240ms. It only runs on page changes, not hash or tab changes.
- **Field focus** (`SetupPage/_hoverOutline.scss`, shared by the Setup page
  and the Create Experiment and Edit Variation modals): hover is a 1px
  `--slate-9` outline; focus is a 1px `--slate-11` outline instead of the
  violet ring.

### Half-built or faked (looks real, isn't)

- **Ends, At End and "If no clear winner" are never saved.** They're
  `STUBBED_FIELDS` in `setupDraft.ts`, local to the page, and reset on
  reload.
- **The At End menu has only two modes.** The real API's
  `scheduledStopPlan` has four (`notify`, `auto-ship`, `force-ship`,
  `stop`). The force-ship and stop helper lines are written and tested but
  can't appear yet.
- **Power analysis is a stub.** **Run Power Analysis** does nothing, and the
  Timing summary always says "No power analysis attached."
  (`powerAnalysisSummary` in `AnalysisPlan.tsx`). The real calculator lives
  in `components/PowerCalculation/`.
- **The Values experiment type, managed values, delivery type and Values
  environments** are stored in localStorage only
  (`TabbedPage/ManagedValuesContext.tsx`).
- **Set up with AI** (Create Experiment): in dev builds, a model failure
  falls back to a fixed demo plan (`SetupPage/aiSetupFixture.ts`, matching
  `packages/front-end/prototype-fixtures/promo-banner-spec.md`). Production
  builds show the error instead. The dev check is `isDevelopmentEnvironment()`
  (`services/env.ts`).
- **Help button** (`components/Auth/InAppHelp.tsx`): hidden on
  `/experiment/[eid]`, and its z-index raised, in dev builds only.

### Decisions, and the alternative rejected

- **Follow the design system over mocks.** `@/ui/` components and Radix
  tokens win where a screenshot differs. Screenshots are used for intent
  only.
- **Modals apply to the draft rather than saving** (Environments, Targeting,
  Namespace, Traffic) so the page has one save path; instant save was
  rejected.
- **Timing starts collapsed.** Its Edit button is an outline button styled
  like the header's "Test" button, at regular (400) weight, always visible.
  Tried and rejected: a hover-only button, a ghost button, and a button
  placed right after the text.
- **Ends defaults to "Manually."** AI-created drafts still open on their
  planned "After N days".
- **The helper line under Ends describes the At End outcome.** "May end
  sooner if "<criteria>" is met" was removed because decision criteria never
  stop an experiment on their own.
- **Primary button hover: bubbles.** Tried and rejected: a sheen, a "liquid"
  wave, and a flowing gradient (multi-hue, then violet-only). Click ring:
  rejected. The quieter ring and a recoil were both tried and dropped.
  Shadows are translucent black, not violet.
- **Page transition: the first version (fade plus 6px rise).**
  Tried and rejected: a cross-fade with a focus pull, and a shared-element
  morph of the experiment name.
- **Focus: a dark outline only.** A soft halo around it was tried and
  rejected. The `--slate-11` outline meets WCAG AA (about 3.9:1 against the
  resting border).
- **Table columns use px widths** (`useTableColumns`) because resizing needs
  them. Percentages stopped the table bleeding off the page but couldn't be
  resized. Each column is capped at 400px; horizontal scroll (as on the
  attributes page) was not added.
- **Header labels and tab counts use `--gray-11` / `--slate-11`.**
  `--slate-10` and `--gray-10` were tried and rejected: below 4.5:1 for 12px
  text.
- **The search icon is `--slate-9`.** `--slate-8` was rejected: below 3:1.
- **Header button labels are 400; primary (solid and soft) buttons stay
  500** (`ExperimentHeader.module.scss` `.headerActions`).
- **One prototype, one branch.** The experiments list work and the
  experiment details work both live on
  `prototype/experiment-page-redesign-main`. There's no separate branch for
  the list (owner, 2026-10-09).
- **Page transition settled** as the first version: fade out, then fade in
  with a 6px rise (owner, 2026-10-09).
- **New behaviour on shared components is opt-in** (`ExperimentsListTable`,
  `ExperimentSearchFilters`, `useSearch`), so other pages don't change.

### Known bugs and rough edges

- **Table width.** Users can drag columns wide enough to push the table past
  the page edge; the 400px per-column cap only limits it.
- **Filters.** Filters added with Add Filter reset when you leave the page,
  and can't be removed from the bar.
- **Table controls at 24px: deferred, not decided.** The density and column
  buttons (`size="1"`, Radix `IconButton`, since `@/ui/` has no icon button or
  button group) are below the design system's default `md` size (32px) and
  read tight. They stay only until table density is revisited. Revisit when
  any of these happens: the table toolbar gains another control; `@/ui/`
  adds an icon button or button group; or the list's row heights or density
  options change.
- **Lint.** The legacy errors in `ExperimentHeader.tsx` (Modal import,
  `size="legacy"`) and `TabbedPage/index.tsx` (Modal import) were already on
  `origin/main`. They are not regressions.
- **Stale decision record.** `docs/prototypes/EXPERIMENT-PAGE-REDESIGN.md`
  still describes the older design-prototypes-based branch, not this one.

### Committed, not yet pushed

Everything since `5f520e108` is committed locally but not pushed to `origin`:

- `826f54173` Experiments list redesign (page, toolbar, table)
- `94e0455c8` Setup page: collapsible Timing, Power row, end-outcome copy,
  tab motion, field focus, header button weights
- `21b05c363` Primary button hover and press, and page transitions
- The commit that adds this file and marks the old decision record
  superseded.

### Next up

1. **Power analysis representation.** The owner is adding one to the
   prototype. Wire it to **Run Power Analysis** and `powerAnalysisSummary` in
   `AnalysisPlan.tsx`.
