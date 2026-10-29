import { defineScenario } from "back-end/test/evals/harness/scenario";

export default defineScenario({
  id: "mc-12",
  title: "Keep assignments without sticky bucketing",
  tags: ["make-changes", "coverage", "release-plan", "no-write"],
  seed: (world) => world.experiment({ status: "running" }),
  user: {
    opening:
      "Cut traffic on the checkout redesign test to 50%, but keep everyone in their variation.",
    instructions:
      "You want the Checkout redesign experiment at 50% of traffic, and you don't want anyone already in it to switch variation. If the assistant says that isn't possible and offers other ways to do it, don't pick any of them: say you'll think about it and end the conversation. Don't ask to change any other setting.",
  },
  confirmCards: "reject",
  expect: {
    plan: "untouched",
    judge: ["explainedStickyRequirement"],
  },
});
