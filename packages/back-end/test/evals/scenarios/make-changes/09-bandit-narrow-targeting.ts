import { defineScenario } from "back-end/test/evals/harness/scenario";
import { sameAudience } from "back-end/test/evals/harness/graders/matchers";
import { DEVICES } from "./audiences";

export default defineScenario({
  id: "mc-09",
  title: "Narrow a bandit to mobile",
  tags: ["make-changes", "targeting", "bandit", "release-plan"],
  seed: (world) =>
    world.experiment({
      name: "Checkout button bandit",
      trackingKey: "checkout-button-bandit",
      status: "running",
      type: "multi-armed-bandit",
      weights: [0.7, 0.3],
    }),
  user: {
    opening: "Narrow the checkout button bandit to mobile users only.",
    instructions:
      "You want the Checkout button bandit to include only users on mobile devices. If the assistant explains a trade-off and asks how to release the change, go with the option it recommends. Don't volunteer anything else.",
  },
  confirmCards: "approve",
  expect: {
    plan: "new-phase-rerandomize",
    phase: {
      condition: sameAudience({ deviceType: "mobile" }, DEVICES),
    },
    judge: ["tradeOffPresentedBeforeCommit", "askedOnlyUserDecisions"],
  },
});
