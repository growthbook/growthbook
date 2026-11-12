import { defineScenario } from "back-end/test/evals/harness/scenario";

export default defineScenario({
  id: "mc-01",
  title: "Raise traffic to 100%",
  tags: ["make-changes", "coverage", "safe"],
  seed: (world) => world.experiment({ status: "running", coverage: 0.5 }),
  user: {
    opening: "Raise traffic on the checkout redesign test to 100%.",
    instructions:
      "You want the Checkout redesign experiment to include all traffic. If the assistant explains a trade-off and asks how to release the change, go with the option it recommends. Don't volunteer anything else.",
  },
  confirmCards: "approve",
  expect: {
    plan: "in-place",
    phase: { coverage: 1 },
    judge: ["askedOnlyUserDecisions"],
  },
});
