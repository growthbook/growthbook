---
name: learnings
description: Search, read, and record Learnings — the durable conclusions a team has drawn across multiple experiments. Use when the user asks "what have we learned about X", "do we already know whether Y works", "have we tested this before", "record this as a learning", or when a finished experiment produces a conclusion worth keeping. Consult before designing a new experiment so you don't re-test something already settled.
---

# Learnings

A Learning is a durable conclusion that spans **multiple** experiments — "urgency
messaging lifts checkout on mobile" — not a summary of a single test. Each one
cites the experiments that support it and the ones that contradict it, so it
carries its own evidence.

Call the GrowthBook REST API through the `callApi` tool. All paths below are
relative to the GrowthBook server.

<when_to_use>
Reach for this skill in three situations:

1. **Before designing an experiment.** Search first — the team may have already
   settled the question, or have contrary evidence worth knowing. This is the
   highest-value use.
2. **When the user asks what's known** about an area, tactic, or audience.
3. **After analyzing a finished experiment**, when the result generalizes beyond
   that one test — offer to record it.
   </when_to_use>

<workflow>
**Finding what's already known** — prefer search over list:

1. `POST /api/v1/learnings/search` with `{"query": "checkout friction"}` ranks
   Learnings by meaning, not keyword. Use this whenever the user's question is
   conceptual. Optional `limit` (max 50) and `projectId`.
2. `GET /api/v1/learnings` when you want a filtered slice rather than a ranked
   one — supports `projectId`, `experimentId`, `tag`, and `status`.
   `experimentId` returns Learnings that cite that experiment in **either**
   direction, supporting or contradicting.
3. `GET /api/v1/learnings/{id}` for one Learning in full.

**Recording a new Learning:**

1. Search first (step 1 above) and read anything close. If one already covers
   the conclusion, update it rather than creating a near-duplicate — add the new
   experiment to `supportingExperimentIds` via
   `PUT /api/v1/learnings/{id}`.
2. Otherwise `POST /api/v1/learnings`:

   ```json
   {
     "title": "Urgency messaging lifts add-to-cart on mobile",
     "text": "Two tests moved add-to-cart with countdown copy...",
     "tags": ["urgency", "mobile"],
     "supportingExperimentIds": ["exp_abc", "exp_def"],
     "contradictingExperimentIds": [],
     "projects": ["prj_123"]
   }
   ```

   Only `title` is required. `status` takes the id of a status configured under
   Settings → General → Experiment Settings; omit it or pass `""` for none —
   an unknown id is rejected.
   </workflow>

<quality_bar>
A Learning is only worth recording if it clears this bar. Be strict — a corpus
full of restated single results is worse than a small one.

- **Two or more experiments.** One result is an experiment outcome, not a
  Learning. If only one test supports it, say so and suggest waiting.
- **Cite the evidence.** Always populate `supportingExperimentIds`, and
  `contradictingExperimentIds` when results disagree. Contrary evidence makes a
  Learning more trustworthy, not less — never omit it to make one look cleaner.
- **Significance, not direction.** Only treat a result as evidence when the
  metric actually moved significantly. An inconclusive test is "no result",
  which is not the same as evidence of no effect.
- **Watch metric direction.** For inverse metrics (bounce rate, unsubscribes,
  latency) a positive lift is a regression. Check which way is good before
  calling something a win.
- **Generalize.** State the transferable pattern and what to do about it, not a
  recap of what happened.
  </quality_bar>

<conventions>
- **Confirm before writing.** Creating and updating are mutations — show the
  user the title and text and get agreement first. Never record a Learning as a
  side effect of an analysis the user asked for.
- **Attribution.** Learnings created through the API are marked `source: "api"`,
  which distinguishes them from AI-discovered and hand-written ones. You do not
  set this.
- **Enterprise-gated.** Creating, updating, and searching require a plan that
  includes Learnings; search additionally needs AI enabled. A 403 means the
  org isn't entitled — report it plainly rather than retrying.
- **Not available over the API:** the AI "find Learnings across experiments"
  and "refresh a Learning" flows are app-only. If the user wants those, point
  them at the Learnings page rather than attempting an API call.
</conventions>

<page_context>
When the user message starts with `[Page context: <path>]`:

- `/learnings` → the Learnings list; treat a bare question as being about the
  whole corpus.
- `/learnings/<id>` → that Learning (`GET /api/v1/learnings/<id>`).
- `/experiment/<id>` → scope to that experiment with
  `GET /api/v1/learnings?experimentId=<id>` before answering "what have we
  learned here".
  </page_context>
