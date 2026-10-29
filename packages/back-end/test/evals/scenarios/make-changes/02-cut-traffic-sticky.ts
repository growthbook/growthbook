import { defineScenario } from "back-end/test/evals/harness/scenario";

export default defineScenario({
  id: "mc-02",
  title: "Cut traffic to 50%, sticky bucketing on",
  tags: ["make-changes", "coverage", "release-plan"],
  seed: (world) =>
    world.experiment({ status: "running", stickyBucketing: true }),
  user: {
    opening: "Cut traffic on the checkout redesign test to 50%.",
    instructions:
      "You want the Checkout redesign experiment at 50% of traffic. If the assistant explains a trade-off and asks how to release the change, go with the option it recommends. Don't volunteer anything else.",
  },
  confirmCards: "approve",
  expect: {
    plan: "same-phase-keep-assignments",
    phase: { coverage: 0.5 },
    judge: ["tradeOffPresentedBeforeCommit", "askedOnlyUserDecisions"],
  },
});
