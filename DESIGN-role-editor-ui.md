# Role editor UI — design note

For `bryce/env-scoped-review`. Companion to `DESIGN-env-scoped-permissions.md`,
which covers the model. This covers the surface.

Build rule applies: no comments unless genuinely needed, `//`, ELI5, max 2 lines.

## Why the current form breaks

Global Role, then "Additional Role N", then "Project Roles (optional)" are three
separate widgets for what is now one concept. Each rule renders as a full stacked
form — role select, a "Restrict Access to Specific Environments" switch, a
multiselect — so two rules already overflow the modal, and nothing shows what the
person actually ends up with.

The model change made global and project rules the same shape:
`(role, scope, environments)`. The UI should stop presenting them as different
things.

## One table

```
Access rules                                        [+ Add rule]
┌───────────┬──────────────┬──────────────────────┬──────────────────┐
│ Role      │ Projects     │ Environments         │ From             │
├───────────┼──────────────┼──────────────────────┼──────────────────┤
│ Engineer  │ All projects │ dev, staging      ✏️ │ Direct        ⋯  │
│           │ ⓘ Not applied in payments                              │
│ Publisher │ All projects │ production        ✏️ │ Direct        ⋯  │
│ Read Only │ payments     │ All environments  ✏️ │ Team: Releases ↗ │
│           │ ⓘ Overrides your All projects rules here               │
└───────────┴──────────────┴──────────────────────┴──────────────────┘
```

Rules are uniform and order does not matter (same-scope rules union), which is
what makes a table right rather than feature-style rule cards.

## Teams are a source, not a second system

Verified: teams contribute rules that **union** with the member's own at the same
scope. They never override. The only override is scope specificity, applied at
lookup: a project entry shadows the "All projects" entry.

So team rules appear as rows in the same table with `From: Team: <name>`,
**read-only**, linking to the team. The tooltip says where to change it.

**The interaction that needs surfacing** (tested, not assumed): a team's project
rule shadows the member's _global_ rule, so joining a team can REDUCE access. A
global Engineer added to a team that has a `payments` Read Only rule drops to
Read Only in payments. Invisible today.

## Overrides are per-scope, so annotate — do not strike through

A rule is rarely wholly overridden: an "All projects" rule shadowed in `payments`
is still live everywhere else. Full strikethrough would be wrong. Annotate the
row with the scope, and let the tooltip carry the detail:

- On the shadowed row: `ⓘ Not applied in payments` → _"payments has its own rule
  (Read Only, from Team Releases), so your All projects rules don't apply there."_
- On the overriding row: `ⓘ Overrides your All projects rules here`

Naming the project is enough; the shadowing is project-level, so it stays correct
if more atoms become environment-scoped later.

## No effective-permissions grid

Considered and dropped. The row annotations carry every case that is not obvious,
including the team-shadowing one, so a grid would mostly restate the table. It
stays worthwhile later as an _org-wide audit_ view ("who can publish to
production"), which is a different screen with a different job.

The one case annotations do not fully resolve is two rules unioning at the same
scope and environment — `Engineer in [dev]` plus `Publisher in [dev]`. The rows
state it plainly and "you have both" is the intuitive reading.

## Environments: three states, not two

`limitAccessByEnvironment` and `environments` encode **three** distinct states,
and all three are reachable and meaningful:

| Stored             | Means                  | Shown as               |
| ------------------ | ---------------------- | ---------------------- |
| `false`, `[]`      | no environment scoping | `All environments`     |
| `true`, `[dev, …]` | scoped                 | `dev, staging`         |
| `true`, `[]`       | scoped to nothing      | `None — no publishing` |

`true + []` is **not** the same as having no role. The role still grants
everything non-environment-scoped — `readData`, `addComments`,
`editFeatureDrafts`, `review*`, `manageArchetype`, `manageTargetingAttributes`,
`manageNamespaces` and more. Only `create* / delete* / publish* / revert*` plus
`runExperiments`, `manageSDKConnections`, `manageSDKWebhooks` and
`manageEnvironments` are blocked. So it means **draft-and-review, never land**,
which is a coherent configuration — not an error to be "fixed".

It is reachable today: the current modal saves with the switch on and the
multiselect empty, and there is no save-time validation.

So the selector must not use emptiness to mean "all".

**Interaction.** Not editing: text plus a pencil. Editing: a `MultiSelectField`
plus an **X** that removes environment scoping entirely.

- X → `limitAccessByEnvironment: false`, `environments: []` → `All environments`
- clearing every chip → `true`, `[]` → `None — no publishing`

The switch disappears: one control, three reachable states, nothing silently
reinterpreted.

## Surface

The table plus inline editing does not fit the current modal. Options are a full
page (matching `/settings/role/[rid]`) or a wide slide-over. Not yet decided.

## Open

- Project column editing — currently a separate "Choose Project… / Add Project
  role" widget; it should become part of the row.
- Whether the same table serves the team editor unchanged (it should — teams
  carry the identical shape).
