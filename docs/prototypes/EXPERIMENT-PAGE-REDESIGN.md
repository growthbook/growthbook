# Experiment page redesign — decision record

Branch: `prototype/experiment-page-redesign` · demo-grade prototype.

This file describes **what is on this branch**. An earlier version of it
described a different direction (v3: no tab row, left rail, drawer editing);
that material is kept, unchanged in substance, in section 7, **Explored, not
taken**.

Entries marked **reasoning: TBD** record a decision visible in the code whose
reason isn't written down anywhere. They're for the owner to fill in.

---

## 1. What this branch is

A design prototype of the **experiment details page** — mainly its Setup tab,
plus the header and the chrome shared by every tab — built for demos and
design review.

- **Built on the design-prototypes repo's `main`**
  (`github.com/growthbook/growthbook-design-prototypes`). That `main` is three
  commits: `Baseline: unmodified growthbook-main`, `Pre-prototyping checkpoint:
CLAUDE.md and environment setup`, `Remove .github/workflows`. This branch
  continues from it.
- **It shares no history with the product repo** (`github.com/growthbook/growthbook`).
  The baseline is a copy of the code, not a fork, so `git merge-base` with
  product `main` finds nothing. Its commits **can't be cherry-picked** onto
  product `main`, and its diff **won't apply** there cleanly: product `main`
  has moved on since the baseline was copied.
- **It's for reading and running, not merging.** Treat it as a working spec.
  Anything that ships should be rebuilt on product `main`, using this branch
  for reference.
- Front-end only, apart from the existing API it already calls. No back-end,
  schema or migration changes. A few things are stubbed or kept in the
  browser; see section 6.

## 2. How to run it, and what to look at

### Running

From the repo root, with Docker running for MongoDB:

```bash
pnpm install
pnpm setup      # first time: builds shared deps and the stats engine
pnpm dev        # back-end :3100, front-end :3000, stats engine on
```

Open `http://localhost:3000` and go to **Experiments**. The local instance this
was built against is seeded with real-shaped data imported read-only from the
"Example App" org (about 51 experiments, 49 feature flags, 5 bandits, 3
templates, 16 namespaces, plus some holdouts), with enterprise features
unlocked by a local licence key. See `CLAUDE.md` for the environment notes.
Secrets live in a gitignored `.env.local`, never in the repo.

### Which experiments show the redesign

There is **no flag**: every standard experiment gets the redesigned page.
**Bandits and holdouts** keep the existing page (`index.tsx`,
`useRedesignedSetup`).

### What each state shows

| Experiment state                            | Lands on | What to look at                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Draft**                                   | Setup    | Everything editable in place; the save bar; the rail's To Do list; header **Test** and **Start Experiment** (Start blocked until the delivery is saved). Drag a variation card's colour bar to reorder; **+** adds a variation; each card's pencil opens its own modal.                                                                            |
| **Draft, start date set, not yet approved** | Setup    | Header **Schedule Start** (clock icon) in place of Start Experiment.                                                                                                                                                                                                                                                                               |
| **Draft, scheduled (approved)**             | Setup    | Header **Scheduled <date>** dropdown: Edit Schedule, Cancel Scheduled Start. Timing's Starts is read-only with a hover pencil into the same Edit Schedule modal. No add/reorder.                                                                                                                                                                   |
| **Running**                                 | Results  | Setup becomes read-only (values, type, split, targeting, namespace and environments locked; empty hypothesis and metrics read "None"). Header **Make Decision** menu (Make Changes, Start a New Phase, Stop Experiment), or the **Make a Decision** split button once a ship / rollback / review recommendation is ready. Advanced stays editable. |
| **Stopped**                                 | Results  | As running; Exposures adds End Time.                                                                                                                                                                                                                                                                                                               |
| **Values** delivery type (any state)        | —        | Implementation's Environments row and a Values row under the variation cards (Type select; JSON opens a full-size editor).                                                                                                                                                                                                                         |
| **Four or more variations**                 | —        | The variation row scrolls sideways; the split stem, Values header and **+** stay put.                                                                                                                                                                                                                                                              |

A tab named in the URL (`#results`, `#health`, …) always wins over the default.

## 3. What's built

### Page chrome (every tab of a redesigned experiment)

- White page background, 32px page edges, a **sticky title row** and **sticky
  tabs** that pin together under the top nav. The pinning offset is one CSS
  variable, `--experiment-tabs-top`, set by the header.
- Default tab from status (section 4), comments hidden on Results and Health
  (they live in the Setup rail), and the Results / Dashboards / Health cards'
  outlines matched to the Setup cards (scoped to those tabs).
- Header actions by state: Test + Start Experiment / Schedule Start / Scheduled
  dropdown (draft); Make Decision menu or Make a Decision split button
  (running).

### Setup tab: main column

- **Hypothesis**: a text area with an AI "Check Hypothesis" action.
- **Implementation**: a grey container holding
  - **Targeting** card: Audience, assignment attribute, and a Conditions row
    whose "View (n)" opens a targeting conditions popover.
  - **Population** card: Included % (edited in place), with the namespace shown
    on the connecting arrow.
  - The **split** (stem, "Split %", per-variation pills) and the **variation
    cards** (colour bar with index notch, name, description, image slot).
  - For the Values type: an **Environments** row and a **Values** row.
  - **Linked changes** for the other delivery types.
- **Analysis Plan**: Goal / Secondary / Guardrail metrics (goal chips open a
  details popover with the Target MDE), a **Timing** box (Starts, Ends) and a
  **Decision** box (Decision Criteria with View Rules, At end, If no clear
  winner), then an **Advanced** accordion holding four cards: Statistics,
  Exposures, Measurement, Metric Overrides.

### Setup tab: right rail

- **Details** tab: General (name, description, project, type, owner, tags…) and
  a **Data** accordion (data source and assignment query), each field editable
  through its own small modal.
- **Comments** tab: a compact comment thread.
- **To Do** tab: the setup checklist; each item jumps to and focuses its
  control, centred in the window. The same list drives the Start button's
  styling.
- Collapsible from a toggle at the end of the tab row.

### Editing model

- **In place, against one page draft** (`setupDraft.ts`). Every field writes to
  the draft; a **page-level save bar** rises from the bottom as soon as there's
  an edit, with **Save** and **Discard Changes**. Save sends only what changed.
- The draft covers the backed fields, the Advanced fields (through
  `AdvancedAnalysisFields`' own form), the Values payload, and the variation
  list (order, adds, renames, deletes).
- Leaving the page with unsaved changes asks first (an **Unsaved Changes**
  modal for in-app navigation; the browser's own prompt for closing or
  reloading).
- A green **toast** confirms a save; it clears itself when the save bar comes
  back for a new change.

### Modals and popovers

| Surface                      | Opened from                                | Notes                                                                                       |
| ---------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------- |
| Variation modal              | A variation card's pencil (drafts)         | Name, description, images (five-across grid); Delete Variation / Cancel / Apply.            |
| Edit Schedule                | Scheduled dropdown; Timing's Starts pencil | The product's `EditScheduleModal` in a `redesigned` mode: current-schedule callout, Submit. |
| JSON value editor            | A JSON value field                         | Full-size modal (`Modal` size `full`).                                                      |
| Unsaved Changes              | Navigating away with unsaved changes       | `@/ui/Modal` parts; Keep Editing / Leave Without Saving.                                    |
| Goal metric popover          | A goal metric chip                         | Description and Target MDE with an override.                                                |
| Targeting conditions popover | Targeting's "View (n)"                     | Attributes, saved groups, prerequisites; JSON when the builder can't show it.               |
| Decision rules popover       | Decision Criteria's "View Rules"           | Numbered rules, conditions, outcomes.                                                       |
| Make Decision menu           | Header, running                            | Make Changes, Start a New Phase, Stop Experiment.                                           |
| Rail field modals            | Rail pencils                               | Name, owner, project, tags, type, environments (Values).                                    |

## 4. Decisions

Each entry: **the decision · the constraint that forced it · what was
rejected.**

### Architecture and editing

1. **Edit in place with one page-level save bar.**
   _Constraint:_ every field on the page writes to one draft and a single Save
   commits it (`setupDraft.ts`). _Rejected:_ the drawer-based editing of the v3
   direction (section 7). **Reasoning: TBD.**
2. **The save bar appears on the first edit,** not when the field loses focus.
   _Constraint:_ none recorded. _Rejected:_ waiting for blur (the earlier
   version). **Reasoning: TBD.**
3. **Controls the design shows but the product can't store are stubbed:** Ends,
   At end, If no clear winner.
   _Constraint:_ the experiment model has no end schedule and no field for
   either decision outcome. They edit the draft and are never sent; Save makes
   them the new local baseline, and a reload loses them (`STUBBED_FIELDS`).
   _Rejected:_ adding schema.
4. **Variation reorder, add, rename and delete are draft edits** committed with
   Save, saved the way the Edit Traffic & Variations modal saves them: each
   variation's record and weight move together, and default keys ("0", "1", …)
   are renumbered by position, so the **index stays with the position and the
   content moves**; custom keys move with their variation.
   _Constraint:_ reuse the modal's semantics rather than reimplement them, and
   keep one save path. _Rejected:_ saving reorder and add immediately (the first
   version of each).
5. **Images are the exception: they save immediately.**
   _Constraint:_ the existing uploader (`ScreenshotUpload`) writes each image to
   the saved experiment by the variation's saved index; a draft version of
   uploads would be a much larger change. Unsaved variations can't take images
   until saved. _Rejected:_ staging uploads in the draft.
6. **Reordering is only possible before start.**
   _Constraint:_ the index is the `variation_id` written to the event stream;
   reordering a running experiment would re-attribute every historical row.
   Once started there's no drag handle at all, not a disabled one.
   _Rejected:_ a disabled handle ("a dead handle invites 'why can't I move
   this'").
7. **Running experiments lock what changes the live experiment** — split,
   targeting, namespace, environments, values and their type, add and reorder.
   _Constraint:_ these change who sees what in a live experiment; the server
   also rejects some of them while the experiment is live in the SDK payload.
   Changes go through **Make Decision → Make Changes**. _Rejected:_ editing them
   in place while running. Stopped experiments are not locked the same way.
   **Reasoning for the exact set: TBD.**

### Page and header

8. **The default tab comes from status alone:** Setup for drafts (scheduled
   included), Results once running or stopped. A tab in the URL always wins.
   _Constraint:_ the same link should land everyone in the same place.
   _Rejected:_ remembering the last tab viewed (the product's behaviour), and
   switching to Results when an experiment is started.
9. **The redesigned chrome holds on every tab,** not just Setup.
   _Constraint:_ the page shouldn't change around you as you switch tabs.
   Scoped changes only (e.g. card outlines on Results / Dashboards / Health)
   rather than component-wide ones. _Rejected:_ Setup-only chrome.
10. **Tabs and the sticky title row pin as one unit, positioned from one CSS
    variable** (`--experiment-tabs-top`).
    _Constraint:_ the tab offsets were hand-synced magic numbers in several
    files; another sticky element would add another copy and fight the tab
    bar's shadow. _Rejected:_ a separately pinned element with its own offset.
11. **Start is blocked only by a missing delivery** (no saved values, or no
    linked changes of the current type). The checklist styles the button but
    doesn't disable it.
    _Constraint:_ none recorded. _Rejected:_ blocking on the whole checklist.
    **Reasoning: TBD.**
12. **Running experiments get one Make Decision menu** (Make Changes, Start a
    New Phase, Stop Experiment), which becomes a **Make a Decision** split
    button when a recommendation is ready (the label opens the decision modal,
    the caret the menu without its ending group).
    _Constraint:_ none recorded. _Rejected:_ the separate Make Changes and Stop
    buttons. **Reasoning: TBD.**
13. **An approved scheduled start shows as a dropdown** (Edit Schedule, Cancel
    Scheduled Start). Editing the time **re-approves the schedule** after
    saving.
    _Constraint:_ the server clears a schedule's approval whenever its time
    changes (`normalizeStatusUpdateScheduleChanges`); without re-approving, an
    edit would silently un-schedule the experiment. _Rejected:_ a "Start now"
    option (removed). **Reasoning for removing Start now: TBD.**

### Components and styling

14. **`@/ui/` first; every fallback is called out in a code comment**
    (`FALLBACK:`). Fallbacks used: Radix `IconButton` (no `@/ui/` icon button),
    Radix `TextArea` (no text area), Radix `Separator` (no divider), legacy
    `components/Forms` fields where Advanced reuses AnalysisForm's controls,
    `CodeTextArea` for JSON. _Constraint:_ `CLAUDE.md` component precedence.
15. **Where a design mock differs from how the existing design-system component
    does it, follow the design system** (e.g. the split button's caret is the
    filled `PiCaretDownFill`, as the existing split button has, not the mock's
    chevron). _Constraint:_ consistency with the shipped design system.
    _Rejected:_ copying the mock.
16. **Advanced's cards are plain boxes styled as the Setup cards, not
    `@/ui/Frame`.** _Constraint:_ `Frame`'s `.appbox` restyles any `.appbox`
    inside it (a darker border and `overflow-x: auto`), which the Metric
    Overrides cards, the window settings box and the slice cards all are — they
    would change and their dropdowns could be clipped. _Rejected:_ `Frame`.
17. **Implementation's grey container is its own component** (`GreyContainer`).
    _Constraint:_ `Frame`'s border can't be turned off and it has no grey fill.
    _Rejected:_ `Frame`.
18. **The Unsaved Changes prompt is built from `@/ui/Modal`'s parts.**
    _Constraint:_ it should match the app's modals (footer divider);
    `@/ui/ConfirmDialog` sits directly on Radix `AlertDialog` without them.
    Closing the tab or reloading can only ever show the browser's own prompt.
    _Rejected:_ `ConfirmDialog`; a three-button Save & Leave version.
19. **Cards and split pills hover with an outline (to `--slate-9`), not a
    fill,** matching the Hypothesis field. _Constraint:_ none recorded.
    _Rejected:_ the light grey fill. **Reasoning: TBD.**
20. **Card and modal image outlines are solid `--gray-4`,** not the translucent
    `--gray-a4`. _Constraint:_ a translucent outline varies with the image under
    it. _Rejected:_ `--gray-a4`.

### Analysis Plan

21. **Advanced is one accordion of four cards** — Statistics, Exposures,
    Measurement, Metric Overrides — regrouping the existing fields without
    changing any control. Measurement and Metric Overrides are hidden until
    there's something to configure. _Constraint:_ a reorganisation, not a
    redesign, of the fields (the original brief). _Rejected:_ four separate
    accordions; a single flat "Advanced" list. **Reasoning for the final card
    form: TBD.**
22. **Statistics is rebuilt from `@/ui/` components;** choosing the default's
    value stores "follow the default" (as "Default (…)" did).
    _Constraint:_ keep the same draft fields and save semantics.
    _Rejected:_ the legacy `StatsEngineSelect` / `SelectField` controls.
23. **Variation IDs are edited in Advanced → Exposures,** as a mapping table
    only (ID and nothing else). _Constraint:_ it replaces the Edit Traffic &
    Variations modal's "Advanced mode" ID column. The helper text ("Must match
    the variation_id values in your data source") is the feature's only
    documentation and is kept whole, in a tooltip.
24. **Target MDE overrides are set from the goal metric popover** and saved to
    the same field the Edit Target MDEs modal uses
    (`decisionFrameworkMetricOverrides`). The chip shows the MDE only when it
    isn't the org default. _Constraint:_ "every chip reading the same 10% hides
    the one that's different". It's an MDE (a power-analysis input), not a
    decision threshold, so it shows no "≥". _Rejected:_ always showing it.
25. **Saving a decision-framework change sends only the part that changed** —
    changing the criteria keeps the saved overrides, and vice versa.
    _Constraint:_ overrides can change elsewhere (the Edit Target MDEs modal)
    after the page loads; re-sending the draft's copy would wipe them.
26. **View Rules opens a popover, not the Decision Criteria modal.**
    _Constraint:_ none recorded. _Rejected:_ the read-only modal.
    **Reasoning: TBD.**

### Delivery types and rail

27. **Delivery types (Values, Feature Flag, Visual Editor, URL Redirect) and
    the Values payload live in the browser** (`localStorage`, keyed by
    experiment id; `ManagedValuesContext.tsx`). _Constraint:_ there's no field
    for them in the product; no schema changes. Ported from an earlier
    prototype with its approvals layer deliberately left out. _Rejected:_
    approvals, for this phase.
28. **A Values experiment's environments default to all of the org's, and at
    least one is required.** _Constraint:_ none recorded. _Rejected:_ the
    earlier "no pre-selection, ever" rule (designed against delivering to an
    environment nobody chose). **Reasoning: TBD.**
29. **The rail's Data section is always an accordion,** open while there's no
    data source and closed once there is. _Constraint:_ none recorded.
    _Rejected:_ remembering its state in the browser; only being collapsible
    once complete. **Reasoning: TBD.**
30. **More than three variations scroll sideways,** each card keeping a third of
    the row; the split stem, the Values header and **+** stay put.
    _Constraint:_ none recorded. _Rejected:_ wrapping or shrinking the cards.
    **Reasoning: TBD.**

## 5. Dependencies and shared-component changes

### Added dependency

- **`@radix-ui/react-toast`** (`packages/front-end/package.json`, plus
  `pnpm-lock.yaml`). Radix Themes has no toast. Wrapped as `@/ui/Toast` and
  mounted once in `pages/_app.tsx` (`ToastProvider`).

### `@/ui/` additions

All **optional and additive**: existing callers render exactly as before.

| Component          | Addition                                                                                                                                                                                 |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Modal`            | A **`full`** size (`calc(100vw - 240px)` wide, `calc(100vh - 148px)` tall, centred); `Body` `flushBottom` and `Footer` `flushTop`, so content scrolls on beneath the footer with no gap. |
| `Popover`          | `sideOffset` (the gap to the trigger, default 0).                                                                                                                                        |
| `Select`           | `valueLabel` (what the closed field shows) and `contentClassName` (a class on the open menu).                                                                                            |
| `DropdownMenu`     | `contentClassName`.                                                                                                                                                                      |
| `MultiSelectField` | `indicatorsStart`, `dropdownIcon`; and the remove button's accessible name fixed to "Remove <name>" (it read "[object Object]" when labels are elements).                                |
| `Toast` (new)      | `ToastProvider`, `useToast()`, and `useDismissToasts()`.                                                                                                                                 |

### Other shared components touched (optional additions)

`DatePicker` (`emptyPlaceholder`, `endIcon`), `MetricsSelector` (`tagSelect`,
`renderSelectedLabel`), `MetricAnalysisWindowSelector` (`label`),
`SortableVariationsList` (`activationDistance`), `EditScheduleModal`
(`redesigned`), `ExperimentStatusIndicator` (`neutralDraft`),
`ManagedValuesDelivery`'s `DeliveryTypeSelect` (label styling).

## 6. Known gaps and open questions

### Stubbed or browser-only

- **Ends, At end, If no clear winner** are stubbed (decision 3).
- **Delivery types, the Values payload and Values environments** are in
  `localStorage` only (decision 27). Another browser, or cleared storage, loses
  them.

### Behaviour gaps

- **Variation IDs on a running experiment** stay editable in Advanced, but the
  server rejects key changes while the experiment is live in the SDK payload;
  the error shows on Save.
- **The Edit Traffic & Variations modal lets you reorder a running
  experiment** (a product behaviour, not gated). The modal's "Advanced mode" ID
  column also still exists, though this page replaces it.
- **No keyboard path for drag-to-reorder** (accepted).
- **Images save immediately,** outside Save / Discard (decision 5).
- **The unsaved-changes guard** catches link clicks and back / forward, not
  navigation the app performs in code.
- **The toast clearing** ignores the save bar for 1.5s after a save, to ride out
  the page settling; a change made in that window won't clear the toast.
- **Lint:** a few files carry pre-existing errors (`size="legacy"`, the legacy
  `Modal` import) that predate this branch.

### Open questions

- **Section-sized empty states:** `@/ui/` has only a page-sized `EmptyState`.
  Should it gain a size rather than a second component?
- **Design-system gaps this prototype worked around:** no display Card, no Tag,
  no search input, no text area, no icon button, no divider, no date picker in
  `@/ui/`.
- **Stopped experiments:** which of the running-state locks (decision 7) should
  also apply once stopped?
- Every **reasoning: TBD** in section 4.

---

## 7. Explored, not taken

Everything below describes the branch as it was during the v3 exploration. Its facts are historical — sections 1–6 are authoritative for the current branch.

> **This is a direction that was explored and abandoned.** It is not what this
> branch builds. It's kept with its reasoning intact so the thinking isn't lost
> and nobody mistakes it for the current design. In it, "v3" means: **no tab
> row, a left rail, three areas, and drawer editing**. Its "Superseded" table
> lists what v3 would have cut — which is largely what this branch _does_ build.

### Design principles

Derive unspecified details from these rather than inventing a new pattern.

- **Weight tracks blocking.** A notice is loud for whoever has to act, quiet for
  everyone else. Amber = _you must act_. Purple = _you are being told something_.
  Green = _done_. Red is reserved for genuinely negative states and is unused.
- **State lives in one place.** Not in the fill, the border, the icon and a chip
  simultaneously.
- **One primary action per surface.** v3's header already enforces this.
- **Labels, not sentences.** A UI caption past ~8 words is documentation.
- **Colour is a finite budget.** Spending it where layout already communicates
  leaves none for what matters.
- **Don't invent components.** Reuse the closest existing one or flag it as new.
- **Inherit data-table primitives** and differentiate by at most one added thing.
- **The left column value is the navigation target** in every data table.
- **Promote by removing a level, not by adding emphasis.**

---

### Approvals

Only engaged when the org requires approvals. One invariant:

> **The experiment record changes at exactly one moment: approval.**
> Saving always stages; approval always publishes. No lifecycle carve-out —
> this holds before the experiment starts and after.

#### Where it is triggered

v3 decision 7 already settles this: **the drawer footer is the only place `Save`
becomes `Request approval`.** Do not add a second trigger anywhere — not the
header, not a page-level banner, not a section control.

#### What the page shows while a request is pending

**The record. Always.** Never the proposed values.

v3's architecture makes this simpler than it was on the tabbed design. Editing is
**modal** — it happens in a drawer and ends when the drawer closes — so there is
no persistent "am I looking at my edits or the real config" ambiguity to resolve.
The page is always the record; the drawer is always the edit.

**Consequence: no published/proposed view switcher.** That whole mechanism was
solving a problem this architecture does not have. It is cut.

#### A pending request is a gate item

This is the reconciliation that matters, and it needs no new chrome.

v3 decision 5 defines a two-way contract: _every amber dot on the page appears in
the gate, and nothing appears in the gate without a dot on the page._ Decision 4
says the gate **gathers what the page already marks** and never computes its own
list.

A change request awaiting approval is, precisely, a blocking item. So:

- The affected **section header carries an amber dot** while its change is awaiting
  approval
- That dot **appears in the gate** like any other blocking item, worded as the
  action it needs — _"Traffic split change awaiting approval"_
- **`Start Experiment` is blocked** by it, via the existing mechanism, with no
  special-casing

This replaces the full-bleed band entirely. The band existed to carry state on a
page that had nowhere else to put it; v3 has the dot contract and the gate.

#### Where the reviewer's prompt lives — OPEN

The dot-and-gate mechanism serves the **requester**. It does not serve a reviewer,
who needs to be told something is waiting on them and taken to it.

v3 has no home for this. Candidates, in order of how native they feel:

1. **The rail's `STATE` block** — already holds status and setup progress, is
   always visible, and costs no new surface
2. A nav item in the rail, beside Comments
3. Something in the header's overflow

Needs designing. Do not improvise it.

#### Request states

| State               | Meaning                                    | In history |
| ------------------- | ------------------------------------------ | ---------- |
| `Draft`             | Saved in the drawer, not submitted. Yours. | No         |
| `Pending`           | Submitted, awaiting review                 | Row one    |
| `Approved`          | Applied to the record                      | Yes        |
| `Changes requested` | Returned to the requester                  | Yes        |
| `Withdrawn`         | Retracted by the requester                 | Yes        |

Three ways to dispose of work, and the line between them is whether anyone else
saw it:

| Action           | Where                                      | Leaves a record?             |
| ---------------- | ------------------------------------------ | ---------------------------- |
| Discard edits    | Drawer footer — reverts to the saved draft | No                           |
| Delete draft     | The draft's own surface                    | No                           |
| Withdraw request | The request's surface                      | **Yes** — status `Withdrawn` |

Withdrawing returns the work to a draft you still have. It does not delete it —
otherwise nobody uses it and stale requests sit in reviewers' queues.

#### The request surface

A **full-page takeover**, not a modal — it needs a URL, because the point of
approvals is sending someone to look at something.

- Diff is a uniform grid: `Field | Before | After`. Low-saturation column washes,
  no strikethrough. Sets show the whole set with unchanged members muted. Empty
  sides read `None`.
- **A first approval has no Before column.** When nothing has ever been approved,
  the left column is not drawn and the header reads `Value`, not `After`. No
  tints — every row would be green, overstating a first approval.
- A **draft** uses the same surface with a dashed `Not submitted` pill and columns
  reading `Current | Proposed`.
- Decision lives in the main content. Approve and Request changes each open a
  confirmation modal carrying the note field — optional for approve, required for
  request changes. Modal size **500**, not the 640 from the managed-values branch.
- `Comment` is not a peer of Approve / Request changes. It sits in the Discussion
  composer, above the thread.
- **The requester never sees Approve.** This is a rule, not a preference — see
  Guard A below.

#### History table

Inherits the product's data-table styling. Leftmost column is the navigation
target.

- Date column is the **request** date on every row, so the pending row has a value
- `Decided by`, not `Approved by` — it holds approvers, changes-requesters and
  withdrawers. Em dash for pending.
- The pending request is **row one**, not a separate card
- A `Draft` never appears — the table is a decision log

#### Role scoping

Weight follows who is blocked, never who is merely interested.

| Who         | Treatment                                         |
| ----------- | ------------------------------------------------- |
| Requester   | Amber dot on the section + gate item              |
| Reviewer    | Needs a prompt — see OPEN above. Amber.           |
| Anyone else | Sees the dot and the gate item; no call to action |

Third-person copy is required for the third case — _"your changes"_ is wrong when
they aren't yours.

#### Copy

Do not use **"Draft"** to name a version or view. The status pill already uses it
for the experiment's lifecycle state.

| Context                         | Wording                                      |
| ------------------------------- | -------------------------------------------- |
| Section dot tooltip / gate item | Traffic split change awaiting approval       |
| Drawer footer, gated            | Request approval                             |
| Request takeover, pending       | Awaiting review · [reviewers]                |
| Approved notice                 | Approved — this experiment is ready to start |
| Changes requested notice        | Changes requested on your request            |

Reviewer-facing copy is blocked on the placement question above.

---

### Verified code facts

Verified against the **feature revision** implementation. Experiments have no
equivalent, so these are precedents to follow or deliberately diverge from.

- **Revision visibility is not user-scoped.** No `createdBy` or `userId` filter at
  the query, API or component layer. Anyone who can read a feature sees every
  revision, its status, and who created it.
- **Guard A — self-review is blocked unconditionally.** In
  `postFeatureReviewOrComment`: `if (createdByUser?.id === context.userId &&
review !== "Comment") throw Error("cannot submit a review for your self")`. No
  org setting, no licence, no role escape, admins included. The creator can still
  leave a plain comment. This is what makes "the requester never sees Approve" a
  rule.
- **Guard B — contributor self-approval** is opt-in via `blockSelfApproval` on a
  per-project review rule, and only engages when `requireReviews` is an array.
  Known gap: `contributors[]` is only populated on drafts created after contributor
  tracking shipped.
- **`bypassApprovalChecks`** lets a holder publish _around_ the requirement. It
  never lets them approve their own draft — Guard A precedes permission logic.
- **`canReview`** resolves to the feature's **primary project only**.
- Approval on an experiment applies changes **immediately**, unlike feature
  revisions where approved ≠ published.

---

### Design system findings

From the step 1 inventory. Carried forward because they still apply.

- **`Frame` cannot lose its border** — it is in the shared `.appbox` style, not a
  prop, and `noBackground` removes fill but keeps the border. `Frame` also has no
  grey fill. Anywhere a grey container is needed, it needs its own plain box.
- **`DataList`** — a grid of label/value pairs — fits read-only label/value
  sections. It does **not** fit Delivery, which is a split bar and a variations
  table.
- **`EmptyState`** exists but is page-sized (very large padding, big title,
  optional 740px image) and is not in `@/ui/`. **v3 decision 1 says there is no
  empty-state screen**, so this is probably moot — doors replace it. Confirm
  before building anything empty-state shaped.
- **Modals** come in 500 and 800 on this branch. The 640 belongs to the
  managed-values branch.
- **Size names differ per component** — buttons `sm/md/lg`, fields
  `small/medium`, tabs `"1"/"2"`. Check each, never assume.
- **No `@/ui/` component for**: spinner, loading skeleton, text area, date picker.
  Text area matters for the Discussion composer and both decision modals. Date
  picker matters for scheduling.

---

### Constraints

- Standalone branch, owned and edited by Gabe. Other branches are not checked,
  diffed or referenced.
- Overlapping files are **logged, not avoided** — a note for whoever reconciles
  branches later, not a rule blocking work here.
- Everything behind a local flag so the current page still renders when it is off.
  Demos are comparative.
- Persistence for drafts and requests is **stubbed** — experiments have no
  revision object. Mark the stub clearly; anyone demoing must know it isn't real.
- Secrets never in chat or the repo; env values in a gitignored `.env.local`.

---

### Working from the design file

`.design-reference/` holds the exported archive. `Experiment Page.dc.html` is the
spec, and the only design source. Nothing else in the archive is authoritative.

- **Take from the design file:** layout, ordering, grouping, which states exist,
  what differs between them, placement.
- **Take from the codebase:** every colour, spacing value, radius, type size, icon
  and component.
- Never inline a hex that has a token. Never rebuild a component that exists. Do
  not copy the design file's markup — it runs, which makes it look like a working
  implementation.
- **This file wins on approvals, principles and code facts. The design file wins
  on layout and placement.** Flag
  any disagreement rather than silently picking one.

---

### Open questions

**Design**

- **Where the reviewer's prompt lives.** The dot-and-gate mechanism serves the
  requester only. Largest open piece.
- Is a draft request **private**? This design says yes; feature revisions say no.
  A divergence, not an inheritance.
- Can a draft exist while another request is `Pending`? If so, what does the
  second draft compare against?
- `Advanced` disclosure contents — proposed principle is that it holds
  per-experiment overrides of org-level defaults. Needs the real field list.
- v3's own open items: decision criteria as a fourth area; environments' home;
  progress denominator.

**Repo queries**

- Which analysis settings have org-level defaults they override, and which are
  experiment-only?
- Does a discard concept exist for feature revisions — soft status or delete? Are
  version numbers reused?
- Can anything today withdraw a revision already in review?
- Does the experiment audit log store per-field before/after, and is the
  `Formatted changes` renderer reusable for our diff?

**For Luke / Bryce**

- Experiments need a revision object. Everything above is stubbed without one.
- The assignment-affecting field list needs sign-off — it drives the warning in
  the Approve modal.
- **The drawer does not exist** (v3's own open item 3) and is the largest new
  piece of work.
- Stale baseline handling. If an approval lands while your request is pending,
  your diff describes a comparison that no longer holds. With more than one person
  editing, this is the expected case.

---

### Superseded

Cut when we moved to v3. Listed so nobody reinstates them from older notes.

| Cut                                                       | Why                                                              |
| --------------------------------------------------------- | ---------------------------------------------------------------- |
| Full-bleed band below the tab bar                         | No tab row exists in v3                                          |
| Setup-tab marker (dot / warning icon)                     | No tabs                                                          |
| Two views — published vs your changes, with a switcher    | Editing is modal in a drawer; no persistent ambiguity to resolve |
| Preview mode, neutral styling, sticky pinning             | Same — the mechanism it belonged to is gone                      |
| Page-level edit mode with `Discard` / `Save draft` footer | The drawer owns the commit boundary                              |
| `Request Approval` as the header primary                  | v3's header has one CTA and it is the gate                       |
| Empty-state variant with CTAs suppressed                  | v3 decision 1 — doors, not empty states                          |
| Right rail with `Details / Comments / To Do`              | Left rail; Comments is a nav item                                |
| Section names Hypothesis / Implementation / Analysis Plan | Three areas named by domain                                      |

**What survived the move:** the invariant, the request state machine, the
discard/delete/withdraw distinction, the takeover surface and its diff grid, the
first-approval single-column rule, the history table, role scoping, the copy
rulings, and every verified code fact.
