---
name: gb-docs-typos
description: >-
  Scan GrowthBook docs and app copy for typos (misspellings, doubled words,
  grammar, split compounds). Use when the user says "check the docs for typos",
  "spellcheck the docs", "docs typo sweep", "any other typos in the docs", or
  names a seed misspelling like defintiions. Matches the classes of fix in
  growthbook/growthbook#7158.
disable-model-invocation: true
---

# Typo sweep

Scan, verify each hit in context, then fix. Do not commit, push, or open a PR
unless asked.

Pattern source: [PR 7158](https://github.com/growthbook/growthbook/pull/7158)
(`chore: fix typos across docs and app`). A pass is incomplete if it only
looks at dictionary misspellings in `docs/**/*.mdx`.

## Scope

| Include                                                      | How to fix                                     |
| ------------------------------------------------------------ | ---------------------------------------------- |
| `docs/` including `docs/api/`, `docs/openapi.yaml`, snippets | Prose: edit in place. Generated API: see below |
| `README.md`, `CONTRIBUTING.md`, package READMEs / CHANGELOGs | Edit in place                                  |
| `packages/**` comments, user-facing strings, test names      | Edit in place                                  |
| Local identifiers (`showVerfiedDomain`, `columType`)         | Rename if **not** exported / not an API field  |

**Generated API copy** (`docs/api/`, `docs/openapi.yaml`,
`packages/back-end/generated/spec.yaml`): the source is the Zod `summary` /
description (usually `packages/shared/src/validators/` or
`packages/back-end/src/api/**/validations.ts`). Fix the source and run
`pnpm generate-openapi`. Hand-editing generated MDX makes the `openapi` CI
job fail.

**Do not rename** exported public API fields or SDK option names unless the
user says to. 7158 did not change those.

Skip binaries, `node_modules`, `dist`, lockfiles, `.husky/_/`.

## Workflow

### 1. Seed (if they named one)

Search the whole repo. Say whether it is on `main`, only on this branch, or
already gone. Do not treat "gone on this branch" as "gone on main."

### 2. Scan

```bash
bash .cursor/skills/gb-docs-typos/scripts/scan.sh
```

If `codespell` is missing, `pip install --user codespell` (or run by full
path). `scan.sh` runs codespell with its builtin dictionary plus
`scripts/misspellings.txt` via `--dictionary=-,path` (the `-D -,path`
form is parsed as a flag). That extra file is only the 7158
typos codespell does **not** already know (`word->correction`, one per
line). Do not dump the whole 7158 list there: overlap is wasted, and
fixed-string greps (`stil` inside `still`) are false positives. Do not stop
after the first page of codespell hits.

Then do a **grammar pass** on docs and READMEs. codespell will not catch
these; 7158 did:

- **Doubled words:** `the the`, `or or`, `to to`, `and and`, `as as`,
  `are are`
- **Split compounds:** `Which ever` → `Whichever`, `straight forward` →
  `straightforward`, `with in` → `within`, `atleast` → `at least`,
  `everytime` → `every time`, `numberline` → `number line`,
  `your self` → `yourself`
- **Verb vs noun:** `how to setup` / `get you setup` → `set up`; `to login`
  → `log in`; `roll out` when it is a verb (keep `rollout` as a noun)
- **Lets:** `Lets` / `lets` + verb → `Let's` / `let's`
- **a / an:** `a SDK`, `a alternate`, `an user`, `An hash`
- **Possessives:** `a users`, `it's own`, `Amplitudes help`, `Twymans law`
- **Agreement / wrong word:** `works well with anywhere` → `work`;
  `may effect` → `affect`; `with he` → `with the`; `Yor` → `You`;
  `Following the X` as an imperative → `Follow`
- **Missing letter in a real-looking word:** `Inremental`, `terrabytes`,
  `strikethough`, `shoes` (for `shows`), `spits` (for `splits`),
  `programatically`, `satisifies`, `interal`, `regresion`

Read surrounding lines. Capitalized words and yaml/js **are in scope**
(codespell used to skip those when we filtered `docs/api` and `*.yaml`).

### 3. Classify

| Bucket   | Action                                                    |
| -------- | --------------------------------------------------------- |
| **Fix**  | Misspelling, doubled word, grammar typo, local identifier |
| **Skip** | False positive or intentional                             |
| **Ask**  | Ambiguous. Show the original sentence                     |

**Skip:**

- MongoDB `$nin` / `nin`
- Intentional SDK examples: `buton`, `weigths` (`# checker error: typo`)
- Kotlin `launchIn`
- Hyphenated `re-use` / `re-using` (valid). Closed `setup` as a **noun** is
  valid (`setup guide`); only fix the verb
- `Covert` when it means secret, not `Convert`
- British spellings used on purpose (`modelling`)
- Exported API / SDK field names

**Existing headings only:** Pin `{#old-slug}` when you change a heading that
already shipped. New headings need no alias.

```mdx
### Configuring an SDK Webhook {#configuring-a-sdk-webhook}
```

### 4. Fix and report

Apply **Fix**. For **Ask**, show the original sentence.

Report:

1. What you fixed (word → word, file)
2. What you skipped, and why
3. Generated-API hits: Zod/source path, and whether you regenerated

Do not mix this sweep into unrelated work. Branch from `main` if needed.
Do not commit `.husky/_/` or unrelated files.
