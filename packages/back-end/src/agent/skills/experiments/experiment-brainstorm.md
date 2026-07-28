---
name: experiment-brainstorm
description: Propose new experiment ideas grounded in the team's past stopped experiments via the GrowthBook REST API. Use when the user asks "what should we test next", "give me experiment ideas", "brainstorm A/B tests", "what's worth testing", or "ideas for experiments". Proposes only — does not create experiments. For designing a specific test, use experiment-design. For reading results of one, use experiment-analyze.
---

# experiment-brainstorm

Propose new experiment ideas grounded in the team's past stopped experiments. Read history first; propose based on what actually moved metrics, where guardrails failed, and which tags or projects under-explored.

Use the `callApi` tool for every REST request. This skill is read-only — it proposes ideas and never creates experiments.

## Workflow

1. **Pull the experiment list, most recent first.**

   ```json
   {
     "method": "GET",
     "path": "/api/v1/experiments",
     "query": {
       "limit": "50",
       "status": "stopped",
       "sortBy": "dateCreated",
       "sortOrder": "desc"
     }
   }
   ```

   Returns up to 50 experiments per page (`limit` caps at 100). Keep `sortBy=dateCreated` with `sortOrder=desc` — the API's default order is oldest-first, and on an org with more than one page of history an unsorted pull grounds every proposal in ancient experiments.

   If the user scoped the brainstorm ("ideas for checkout", "what should the growth team test next"), narrow the pull with filters instead of discarding results after the fact: add `"tag": "checkout"`, `"projectId": "prj_abc123"`, or `"owner": "<email>"` to the query. `tag` and `owner` take comma-separated values (ORed within a param); `projectId` takes a single project id. Separate params AND together.

2. **Fetch results for each stopped experiment.** Loop over the stopped IDs:

   ```json
   { "method": "GET", "path": "/api/v1/experiments/<id>/results" }
   ```

   Pace the calls — the API is rate-limited at 60 requests per minute. Cap the pull at ~20 experiments unless the user explicitly wants more; that's plenty for pattern-finding and stays well inside the budget.

3. **Read the patterns.** From the result payloads, identify three things before proposing anything:
   - **What's working** — themes shared by experiments where the test variation beat the control (which projects, which surfaces, which kind of change).
   - **What's stalling** — themes shared by losers and inconclusive tests.
   - **What's under-explored** — projects, tags, or surfaces with few experiments compared to the rest.

4. **Compute light aggregate context.** Mentally tally — no need to surface a full dashboard:
   - Approximate win rate (won / total settled).
   - Top 3 winners by absolute lift on the primary metric.
   - Top 3 losers by absolute lift.
   - Any experiments flagged for SRM (sample ratio mismatch).
   - Project / tag distribution.

5. **Propose 5–7 ideas.** Each proposal contains:
   - **Hypothesis** in one sentence: "If we change X, then Y will improve, because Z."
   - **Why this is grounded** — one sentence linking it to a specific past experiment (winner to extend, loser to retry differently, gap to fill). Cite the experiment name or ID.
   - **Primary metric** — pick one. State the type (proportion, mean, ratio, quantile) and why.
   - **Expected effect size** — order of magnitude only ("comparable to the +3.2% lift on the checkout flow test"), not a precise number.
   - **Risk to watch** — one guardrail metric or potential regression.

6. **Present with structure.** Lead with the patterns you saw (1–2 lines each), then the proposals. End by asking the user which to refine — do not start designing or creating experiments inside this skill. Call `loadSkill('experiment-design')` for the one(s) the user picks.

## Guardrails

- **Stopped experiments only.** Filter drafts and running experiments out of your synthesis. If the user asks about the live pipeline, that's a different question — point them at `loadSkill('flag-search')` or `loadSkill('experiment-design')` instead.
- **Ground every proposal.** Cite the specific past experiment(s) you're building on. No proposals based on generic best practices.
- **Don't repeat losers without saying why.** If a proposal mirrors a recent loser, say so explicitly and explain what's different this time.
- **Win rate definition:** `won / (won + lost + inconclusive)`. Don't invent another formula.
- **Watch for SRM and guardrail issues in the history.** If many experiments show SRM failures, mention it and propose at least one idea aimed at improving experiment hygiene rather than another product test.
- **Propose, do not create.** Never POST to `/api/v1/experiments`. The user's next step is `experiment-design` for the proposal they want to pursue.
- **Avoid metric-fishing proposals.** Each idea has one (occasionally two) goal metric. Don't propose tests with five metrics hoping one moves — that's the "too many goal metrics" footgun. GrowthBook's decision framework supports up to two goal metrics, but more dilutes power and confuses the ship/kill call.
- **Rate limit awareness.** 50 experiments + 20 result fetches = ~21 calls; well under the 60 rpm cap. If the user wants more depth, ask before fanning out to >40 calls.

## Endpoints used

- `GET /api/v1/experiments?limit=50&status=stopped&sortBy=dateCreated&sortOrder=desc` — list stopped experiments, newest first (`limit` caps at 100). Optional scoping filters: `tag` and `owner` (comma-separated values ORed within a param), `projectId` (single project id).
- `GET /api/v1/experiments/{id}/results` — full results for one experiment. One call per stopped experiment in scope.

## Output template

```
## Patterns from your last N stopped experiments

- Working: <theme>
- Stalling: <theme>
- Under-explored: <theme>

## Proposed experiments

### 1. <short title>
- Hypothesis: …
- Grounded in: <past experiment + verdict>
- Primary metric: <name> (<type>)
- Expected effect: <order of magnitude>
- Risk: <guardrail>

…

Pick one or two and I'll hand off to experiment-design to scope it.
```
