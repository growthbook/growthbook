import { defineScenario } from "back-end/test/evals/harness/scenario";

export default defineScenario({
  id: "mc-08",
  title: "Start a new phase",
  tags: ["make-changes", "new-phase", "release-plan"],
  seed: (world) => world.experiment({ status: "running" }),
  user: {
    opening: "Start a new phase on the checkout redesign test.",
    instructions:
      "You want a fresh phase on the Checkout redesign experiment so its analysis starts over. If the assistant explains a trade-off and asks how to release the change, go with the option it recommends. Don't volunteer anything else.",
  },
  confirmCards: "approve",
  expect: {
    plan: "new-phase-rerandomize",
    judge: ["askedOnlyUserDecisions"],
  },
});
