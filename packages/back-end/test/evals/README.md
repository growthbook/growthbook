# Agent evals

Scenarios that seed a GrowthBook org, give an agent a request, play the user, and grade the state the agent leaves behind. They run in two layers:

- **Key-free, in `pnpm test`.** `scenarios.test.ts` seeds every scenario and replays its `referenceActions` (the ideal agent's API calls) through the REST handlers, then runs the state and call graders. It proves the seeds are valid and that the graders accept the correct outcome and reject an untouched one. `graders.test.ts` unit-tests the graders.
- **Live, on demand.** `pnpm --filter back-end eval <suite>` runs repeated trials against a real model and grades them, adding an LLM judge for the conversation. It never runs in CI.

## Running a suite

```bash
pnpm --filter back-end eval make-changes                  # 12 scenarios × 3 trials
pnpm --filter back-end eval smoke --trials 1
pnpm --filter back-end eval make-changes --scenario mc-03,mc-04 --trials 5
pnpm --filter back-end eval make-changes --tag release-plan --profile no-skills
pnpm --filter back-end eval smoke --driver claude-code --profile plugin
```

| Flag                                 | Default             | Meaning                                            |
| ------------------------------------ | ------------------- | -------------------------------------------------- |
| `--trials`                           | 3                   | Trials per scenario                                |
| `--scenario`, `--tag`                | all                 | Filter scenarios by id (comma-separated) or tag    |
| `--driver`                           | `in-app`            | Which agent to drive                               |
| `--profile`                          | per driver          | What the agent knows (below)                       |
| `--model`                            | `claude-sonnet-5-5` | The in-app agent's model                           |
| `--concurrency`                      | 4                   | Trials in flight at once                           |
| `--threshold`                        | the suite's         | Pass rate the run must reach                       |
| `--simulator-model`, `--judge-model` | Sonnet, Opus        | Claude models for the simulated user and the judge |
| `--skip-assemble`                    | off                 | Reuse the already assembled skills                 |

**Authentication.** The simulated user, the judge, and the `claude-code` driver all run through the `claude` CLI and use your Claude Code login, so they need no API key; the run stops up front if you aren't logged in. Only the `in-app` driver needs a provider key, because it runs GrowthBook's own agent, which calls the provider's API the way production does: `ANTHROPIC_API_KEY` (or the key for the `--model` you pick) from the shell or `packages/back-end/.env.local`, which is read for provider keys only.

**Skills under test.** The command runs `assemble-skills` first, so it uses whatever skills source that resolves: `$SKILLS_SRC`, then `agent-skills.local.json`, then `skills-src/`. Point `SKILLS_SRC` at a local `growthbook/skills` branch to test a playbook change, and compare its `summary.json` with a run on the pinned skills or with `--profile no-skills`.

| Driver        | Profile     | What the agent gets                                                                    |
| ------------- | ----------- | -------------------------------------------------------------------------------------- |
| `in-app`      | `skills`    | The in-app assistant with the assembled skills                                         |
| `in-app`      | `no-skills` | The same assistant with every skill domain disabled for the org                        |
| `claude-code` | `mcp`       | The GrowthBook MCP server with its bundled skills                                      |
| `claude-code` | `mcp-api`   | The same server with skills off                                                        |
| `claude-code` | `plugin`    | The Agent Skills plugin from the run's skills checkout, calling the API with `gb-call` |
| `claude-code` | `bare`      | A base URL, an API key, and the OpenAPI spec, with only `curl` in the shell            |

The `claude-code` driver runs `claude -p` per user message against an eval server: the real app with real API-key auth on a local port, recording every call by key. Each trial gets a throwaway org and key, its own temp working directory, `--restricted` and `--strict-mcp-config`, a minimal environment, and only its profile's tools, so your Claude Code settings, hooks, CLAUDE.md, plugins, MCP servers, and GrowthBook key don't reach its context. That keeps the agent's setup reproducible; it isn't a security sandbox. `--restricted` confines only the file tools, so the `bare` profile's `curl` can still read local files and reach other hosts. It signs in with your Claude Code login (the run stops if it finds an API key instead), and each trial's saved session is purged afterward. External agents have no confirm cards, so `confirmCards` doesn't apply to them.

## Reading results

The console prints pass@1 and pass^k per scenario, the suite pass rate against the threshold, and the cost. The command exits non-zero only when the suite pass rate is below the threshold; one failed trial is a data point, not a regression.

Each run writes `.results/<run>/` (gitignored): `summary.json` with the run's metadata (GrowthBook and skills SHAs and whether they were dirty, driver, profile, models), plus one `<scenario>-<trial>.json` and a readable `<scenario>-<trial>.md` transcript with the graders' reasons per trial.

A trial passes when all three graders pass:

- **state**: the requested fields changed, the phase count, seed, and bucket versions match the expected release plan, and nothing else on the experiment changed.
- **calls**: no forbidden write, such as the generic update rewriting a running experiment's phases.
- **judge**: the conversation criteria the scenario lists, such as showing the trade-off before committing. The judge also checks the simulated user; a trial where it broke character is re-run and not counted. Before trusting a new criterion, label 10–20 transcripts by hand and check the judge agrees.

## Writing a scenario

A scenario is one file under `scenarios/<suite>/`, registered in that suite's `index.ts`:

```ts
export default defineScenario({
  id: "mc-03",
  title: "Cut traffic to 50%, sticky bucketing off",
  tags: ["make-changes", "coverage", "release-plan"],
  seed: (world) => world.experiment({ status: "running" }),
  user: {
    opening: "Cut traffic on the checkout redesign test to 50%.",
    instructions:
      "You want 50% of traffic. If asked how to release it, go with the recommendation.",
  },
  confirmCards: "approve",
  expect: {
    plan: "new-phase-rerandomize",
    phase: { coverage: 0.5 },
    judge: ["tradeOffPresentedBeforeCommit", "askedOnlyUserDecisions"],
  },
  referenceActions: ({ experimentId }) => [
    /* the ideal agent's calls */
  ],
});
```

- `seed` builds state with the `World` helpers; each trial gets its own org.
- `expect.plan` names the footprint in `harness/graders/plans.ts`. Those signatures are written from the Make Changes wizard's behavior on purpose and never imported from the server, so a wrong server table can't grade itself as correct.
- Use matchers from `harness/graders/matchers.ts` when there's more than one correct value (`sameAudience` for conditions, `inNamespace`, `weights`).
- Judge criteria live in `harness/graders/criteria.ts`; a scenario can also pass `{ key, rubric }` inline.
- Add `referenceActions` as soon as the endpoints they need exist, so `pnpm test` checks the scenario key-free.

## Moving to Vitest

Code under `harness/` and `scenarios/` doesn't import Jest. The runner-specific parts are `jest.evals.config.mjs`, `setup.ts` (the only module mocks), the `*.eval.ts` wrappers, and the two `*.test.ts` files, so a Vitest move swaps those and leaves the harness alone. Verdicts and the threshold come from the harness, not the runner.
