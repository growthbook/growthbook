import { defineScenario } from "back-end/test/evals/harness/scenario";

export default defineScenario({
  id: "mc-11",
  title: "Set traffic on a draft",
  tags: ["make-changes", "coverage", "draft"],
  seed: (world) => world.experiment({ status: "draft" }),
  user: {
    opening: "Set traffic on the checkout redesign experiment to 50%.",
    instructions:
      "You want the Checkout redesign experiment, which hasn't started yet, to use 50% of traffic once it starts. Don't ask to start it, and don't volunteer anything else.",
  },
  confirmCards: "approve",
  expect: {
    plan: "in-place",
    phase: { coverage: 0.5 },
    judge: ["askedOnlyUserDecisions"],
  },
});
