import { z } from "zod";
import { aiTool } from "back-end/src/enterprise/services/ai";
import type { AgentConfig } from "back-end/src/enterprise/services/agent-handler";
import { generalAgentConfig } from "back-end/src/agent/general-agent";

// The Slack assistant reuses the General agent's brain (callApi + skills) but
// adds one Slack-specific capability: attaching a rich experiment results card
// (rendered server-side to a PNG) to the reply. We compose a variant config
// rather than touching the shared web-chat agent.

const SLACK_PROMPT_APPENDIX = `
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
        // Signal the Slack bridge to render + post the card after the turn.
        // Rendering/delivery happens outside the agent loop so a render error
        // never derails the model.
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
