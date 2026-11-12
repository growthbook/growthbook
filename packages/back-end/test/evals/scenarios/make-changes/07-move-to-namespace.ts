import { defineScenario } from "back-end/test/evals/harness/scenario";
import { inNamespace } from "back-end/test/evals/harness/graders/matchers";
import { NAMESPACE } from "back-end/test/evals/harness/world";

export default defineScenario({
  id: "mc-07",
  title: "Move into the checkout namespace",
  tags: ["make-changes", "namespace", "release-plan"],
  seed: (world) => world.experiment({ status: "running" }),
  user: {
    opening: "Move the checkout redesign test into the checkout namespace.",
    instructions:
      "You want the Checkout redesign experiment in the \"checkout\" namespace so it can't overlap other checkout tests. If asked how much of the namespace to use, say the first half. If the assistant explains a trade-off and asks how to release the change, go with the option it recommends. Don't volunteer anything else.",
  },
  confirmCards: "approve",
  expect: {
    plan: "new-phase-rerandomize",
    phase: { namespace: inNamespace(NAMESPACE) },
    judge: ["tradeOffPresentedBeforeCommit", "askedOnlyUserDecisions"],
  },
});
