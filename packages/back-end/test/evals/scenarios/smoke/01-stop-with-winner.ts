import { defineScenario } from "back-end/test/evals/harness/scenario";
import { present } from "back-end/test/evals/harness/graders/matchers";

export default defineScenario({
  id: "smoke-01",
  title: "Stop with a winner",
  tags: ["smoke", "lifecycle"],
  seed: (world) => world.experiment({ status: "running" }),
  user: {
    opening: "Treatment won on the checkout redesign test. Please stop it.",
    instructions:
      "You want the Checkout redesign experiment stopped, with Treatment as the winner. If asked whether to roll Treatment out to everyone through the experiment, say no: you'll update the flag yourself later. Leave the feature flag as it is. If asked for a reason or a summary, say Treatment improved checkout conversion.",
  },
  confirmCards: "approve",
  expect: {
    plan: "stop",
    experiment: {
      status: "stopped",
      results: "won",
      winner: 1,
      // No temporary rollout: the user ships through the flag later.
      excludeFromPayload: true,
    },
    phase: { dateEnded: present() },
    judge: ["askedOnlyUserDecisions"],
  },
  referenceActions: ({ experimentId }) => [
    {
      method: "POST",
      path: `/api/v1/experiments/${experimentId}/stop`,
      body: {
        results: "won",
        winnerVariationId: "var_treatment",
        enableTemporaryRollout: false,
        reason: "Treatment improved checkout conversion",
      },
    },
  ],
});
