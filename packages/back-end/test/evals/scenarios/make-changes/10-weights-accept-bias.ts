import { defineScenario } from "back-end/test/evals/harness/scenario";
import { weights } from "back-end/test/evals/harness/graders/matchers";

export default defineScenario({
  id: "mc-10",
  title: "70/30 without reassigning anyone, bias accepted",
  tags: ["make-changes", "weights", "advanced", "release-plan"],
  seed: (world) =>
    world.experiment({ status: "running", stickyBucketing: true }),
  user: {
    opening:
      "Move the checkout redesign test to 70/30, with 70% on Control, but don't reassign anyone. I accept the bias.",
    instructions:
      "You want Control at 70% and Treatment at 30% on the Checkout redesign experiment, and nobody already in the experiment should switch variation. You understand this can bias the results and accept that. Don't volunteer anything else.",
  },
  confirmCards: "approve",
  expect: {
    plan: "same-phase-keep-assignments",
    phase: { variationWeights: weights([0.7, 0.3]) },
    judge: ["biasWarningShown", "askedOnlyUserDecisions"],
  },
});
