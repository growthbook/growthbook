import { z } from "zod";
import { aiTool } from "back-end/src/enterprise/services/ai";
import type { AgentConfig } from "back-end/src/enterprise/services/agent-handler";
import { generalAgentConfig } from "back-end/src/agent/general-agent";

// The Slack assistant reuses the General agent (callApi + skills) and adds one
// capability: attaching a server-rendered experiment results card (PNG) to the
// reply. Composed as a variant config rather than touching the web-chat agent.

const SLACK_PROMPT_APPENDIX = `
# Talking in Slack

You are replying to a person in Slack, not driving the GrowthBook app. Adjust
how you write accordingly — this OVERRIDES the sidebar-assistant guidance above.

- **Never expose implementation details.** Don't mention API endpoints, HTTP
  methods/verbs, status codes, tool names, or raw query strings. The reader
  doesn't care that you called \`GET /api/v1/experiments\` — they care about the
  answer. Speak in product terms ("I found 8 running experiments"), never in
  terms of the calls you made to get it.
- **Link generously here** (unlike the sidebar, where links are kept sparse).
  When you name an experiment, feature, metric, or other entity, link it. In a
  list, link every item.
- Use a **bulleted list** when returning more than ~2 entities — one bullet per
  item, each with a linked name — rather than a comma-separated sentence.
- Links are same-origin **relative paths** exactly as documented above (e.g.
  \`[my-exp](/experiment/exp_abc123)\`). They're rewritten into absolute Slack
  links automatically — do not build absolute URLs or guess a host.
- **Always wrap a path in markdown link syntax** \`[label](/path)\` with a
  human-readable label. NEVER write a bare path in prose — a raw \`/experiments\`
  renders as plain text in Slack, not a clickable link. E.g. write
  "see the [full experiments list](/experiments)", never "see the list: /experiments".
- Prefer human-readable names as link labels; don't surface internal IDs in
  prose (they're fine inside the link path).

Example — "what experiments are running?" should read like:

  There are 8 experiments running right now:
  • <checkout-redesign>
  • <homepage-hero>
  …

(each name a link to \`/experiment/<id>\`), followed by an optional one-line note.

# Describing metrics

When you name a metric (e.g. an experiment's goal/primary metric):

- **Link it, never print the raw id.** A fact metric (id begins \`fact__\`) lives
  at \`/fact-metrics/<id>\`; a classic metric (id begins \`met_\`) lives at
  \`/metric/<id>\`. Write \`[Engaged Users](/fact-metrics/fact__abc123)\` — never
  "Engaged Users (fact__abc123)".
- **Include the useful metadata** you already have from fetching it, in a short
  phrase — not a dump:
  - its **type** (proportion / mean / ratio / quantile),
  - whether it's an **Official** metric — a metric is Official when its
    \`managedBy\` field is set (non-empty, e.g. \`"admin"\`); Official metrics are
    curated/locked-down, so it's a useful trust signal to call out,
  - its **owner** and **tags** when relevant.
- So instead of "the primary metric is Engaged Users (fact__abc123)", write:
  "the primary metric is [Engaged Users](/fact-metrics/fact__abc123), an
  Official proportion metric owned by Jane."

# Slack results cards

You are answering inside Slack. When the user asks how an experiment is doing —
its results, status, whether it won or lost, or how a variation is performing —
first fetch the experiment (GET /api/v1/experiments/{id}), then call the
\`showExperimentResults\` tool with that experiment's id. It attaches a visual
results card (per-variation values, chance to win, confidence intervals) to
your reply.

- Still end with ONE short (1–3 sentence) text summary referencing the key
  numbers — the card complements it, it doesn't replace it.
- Only call it for a real experiment id you've confirmed exists. Don't call it
  for feature flags, and skip it for draft experiments with no results yet
  unless the user specifically wants the setup.
- Call it at most once or twice per reply (for the experiment(s) actually
  being discussed).
`.trim();

const showExperimentResultsInput = z.object({
  experimentId: z
    .string()
    .min(1)
    .describe(
      "The GrowthBook experiment id (e.g. exp_abc123) to render a card for.",
    ),
});

const SHOW_EXPERIMENT_RESULTS_DESCRIPTION =
  "Attach a rich visual experiment results card (per-variation values, chance " +
  "to win, confidence-interval violins) to your Slack reply. Call after " +
  "confirming the experiment exists. Then add a short text summary.";

export const slackAgentConfig: AgentConfig<Record<string, never>> = {
  ...generalAgentConfig,
  // Keep Slack conversations grouped separately from the in-app assistant.
  agentType: "slack",

  buildSystemPrompt: async (ctx, params) =>
    (await generalAgentConfig.buildSystemPrompt(ctx, params)) +
    "\n\n" +
    SLACK_PROMPT_APPENDIX,

  buildTools: (ctx, buffer, params, emit) => ({
    ...generalAgentConfig.buildTools(ctx, buffer, params, emit),
    showExperimentResults: aiTool({
      description: SHOW_EXPERIMENT_RESULTS_DESCRIPTION,
      inputSchema: showExperimentResultsInput,
      execute: async (input) => {
        // Signal the Slack bridge to render + post the card after the turn —
        // outside the agent loop, so a render error never derails the model.
        if (emit) emit("experiment-card", { experimentId: input.experimentId });
        return {
          status: "ok" as const,
          message:
            "A results card for this experiment will be attached to the reply. Add a short text summary of the key numbers.",
        };
      },
    }),
  }),
};
