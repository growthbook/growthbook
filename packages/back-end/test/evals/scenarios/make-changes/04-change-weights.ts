import { defineScenario } from "back-end/test/evals/harness/scenario";
import { weights } from "back-end/test/evals/harness/graders/matchers";

export default defineScenario({
  id: "mc-04",
  title: "Move a 50/50 split to 70/30",
  tags: ["make-changes", "weights", "release-plan"],
  seed: (world) => world.experiment({ status: "running" }),
  user: {
    opening:
      "Move the checkout redesign test to a 70/30 split, keeping 70% on Control.",
    instructions:
      "You want Control at 70% and Treatment at 30% on the Checkout redesign experiment. If the assistant explains a trade-off and asks how to release the change, go with the option it recommends. Don't volunteer anything else.",
  },
  confirmCards: "approve",
  expect: {
    plan: "new-phase-rerandomize",
    phase: { variationWeights: weights([0.7, 0.3]) },
    judge: ["tradeOffPresentedBeforeCommit", "askedOnlyUserDecisions"],
  },
});
