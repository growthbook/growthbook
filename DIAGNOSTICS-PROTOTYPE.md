# Feature Flag Diagnostics — prototype branch

**This is a design prototype, not a pull request.** It exists so the Diagnostics
work can be looked at, argued with and demoed. Parts of it are deliberately
fake, one commit mixes in older uncommitted work, and nothing here has been
reviewed in a browser by anyone other than the author. Please read this file
before forming an opinion about anything in the diff.

---

## How to look at it

Two surfaces:

- **Feature flag → Overview tab** — the Rules section, now with a Traffic panel
  beside it.
- **Feature flag → Diagnostics tab** — the chart, the breakdown panel and the
  Evaluation Stream.

Add **`?dummy=true`** to the feature page URL to render against a local
fixture instead of the warehouse. You will want this: several things in the UI
have no real data behind them yet, and in dummy mode they are populated.

---

## What is fake, and why

### User identity and attributes do not exist in `feature_usage`

The managed table is narrow: `timestamp, client_key, environment, feature,
value, source, ruleId, variationId`. There is **no identity column** and **no
attributes payload**. `unit_id` appears in
`docs/docs/features/diagnostics.mdx` as a suggestion, but the managed table
does not have it.

So the evaluation drawer — the one that opens from a caret on each stream row
— is full in dummy mode and nearly empty on real data. **That is correct
behaviour, not a bug.** On real data it renders no User ID column, no user id
in the drawer header, and the attributes empty state.

The fake data is isolated in:

```
packages/front-end/components/Features/featureDiagnosticsDummyUsers.ts
```

marked `FAKE DATA`. Removing it when the real columns land is three deletions:
that file, its import, and one line in the dummy row generator. No rendering
code needs unwinding — the UI reads the same fields either way.

The fixture deliberately covers the awkward cases: 12 users across 60 rows with
an uneven distribution, key counts from 6 to 20, mixed types including
`string[]` and `number[]`, and **two users who send no attributes at all**, so
the empty state is exercised rather than assumed.

### What has to be built for the drawer to be real

1. The SDK sends the attributes object it evaluated against.
2. A column holds it.
3. The ClickHouse projection carries it.
4. Identity — some form of `unit_id` — lands in the managed table.

Until then the drawer shows the row's own fields plus an honest empty state.
This is an engineering dependency, not an unresolved design question.

---

## Derivations — please don't re-derive these differently

These were worked out against the actual data path and are exact. They look
like approximations and aren't.

**`$default` is measured, not inferred.** The SDK writes the literal string
`$default` into `ruleId` on fall-through, so default value has a real count.
It is never computed by subtracting rules from the total.

**Served without a rule = `rowsMeta.ruleId.includedEvaluations − sum(byRuleId)`.**
`byRuleId` drops rows with an empty `ruleId` — SDK overrides, failed
prerequisites, and `unknownFeature` (an SDK whose payload doesn't know the
flag). The subtraction is exact because the two sets differ only by those rows,
and it stays exact even when `""` falls outside the top-25 group fold.

**Rows lost to the cap = `total − includedEvaluations`.** The warehouse query
caps at 15,000 rows, keeping the busiest groups. These evaluations were counted
but have no per-rule row, so they are stated under the bar rather than drawn in
it.

**Rule ids must be matched on the stem.** The payload emits `stemRuleId`, so a
rule stored as `fr_abc__production` arrives as `fr_abc`. A direct string
compare against the rule list misses every v1-migrated rule and renders each
one as _deleted_ — a wrong answer that looks confident. Use
`packages/shared/src/util/ruleId.ts`.

**Colour follows the rule, never its volume.** `buildSeriesColors` in
`featureEvaluationsBreakdown.ts` assigns by the rule's position in the flag's
rule list. The same rule is the same colour in the Diagnostics chart, the
breakdown panel, the stream's Rule cell and the Overview Traffic panel. If you
change that assignment, change it once — four surfaces read it.

---

## Deliberate decisions that look like bugs

**Colours wrap past 8 rules.** Rule 9 takes rule 1's hue. The index pill is
what disambiguates. Changing the wrap here would desync this card from the
Diagnostics chart, so it was left alone.

**The Traffic panel lists every rule on the flag**, so on a single-environment
tab, rules that don't exist in that environment show 0%. Known; small fix if
wanted.

**The stream's Rule cell carries no index number**, unlike the breakdown panel.
The panel describes current config, where "1" means first rule and is true. A
stream row is history: reorder the rules and every older row's number silently
points at a different rule. A name can go stale after an edit; a number goes
wrong.

**"Rule is null" maps to `= ''`.** No-rule is stored as an empty string, not
NULL, so the operator would otherwise never match.

**`value` comparisons are on stored text**, not typed values — `"false"` the
string on a boolean flag, the serialised JSON on a JSON flag.

**Source tokens are shown raw** (`defaultValue`, `force`, `experiment`) rather
than sentence-cased, because people cross-reference them against their own
warehouse queries.

**The timestamp shows milliseconds only when the data has them**, and is never
truncated.

---

## Cost — worth a decision, not introduced here

Every feature page view fires `/feature/:id/usage?lookback=week`, which is a
7-day scan of the managed ClickHouse. SWR's default also refetches it when the
browser tab regains focus.

Neither behaviour was introduced by this branch — but this is the first time
anyone looked straight at it, and ClickHouse bills on bytes scanned. The
Traffic panel adds no new query; it displays data the page already fetched.

Mitigation already in place: a narrowed view (any environment scope or filter
applied) stops the 5-second auto-refresh and leaves the manual refresh control.

---

## Commit hygiene

Most commits are scoped to one change. **One front-end commit explicitly mixes
unseparated pre-session prototype work with this session's features** and says
so in its message, with a per-file note of which is which. It was not possible
to separate them — there was no snapshot of those files from before the work
started. Please don't go hunting for a cleaner history; it doesn't exist.

Also worth knowing: a change to the usage chart's time buckets is its own
commit, because it alters behaviour rather than arrangement — bucket widths
go from 1min→30s (15 minutes), 5min→1min (hour), 1h→20min (day), 6h→2h (week),
and the group cap from 50 to 150.

---

## Open questions for engineering

1. **`client_key`** is in `feature_usage` but not in the projection. It is the
   only per-row fact that says _which SDK connection_ served an evaluation —
   "it works on web but not on iOS" is a real support ticket. Worth adding?
2. **Attributes and identity** — see above. This is the gating dependency for
   the drawer.
3. **The 7-day scan on every page view**, and the focus refetch. Acceptable or
   not?
4. **Is the 25-group fold distinguishable from a true zero?** A rule that falls
   into `(other)` and a rule with no traffic currently look the same.
5. **Event Logs has two defects** that were deliberately left untouched so that
   surface stays byte-identical: its drawer caret uses `display: none`, so
   keyboard users cannot reach it, and its rows open the drawer on click, which
   breaks text selection. The Diagnostics drawer does both correctly; the two
   now sit side by side.
