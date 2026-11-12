import { defineScenario } from "back-end/test/evals/harness/scenario";
import { sameAudience } from "back-end/test/evals/harness/graders/matchers";
import { COUNTRIES } from "./audiences";

export default defineScenario({
  id: "mc-06",
  title: "Remove the country condition",
  tags: ["make-changes", "targeting", "safe"],
  seed: (world) =>
    world.experiment({
      status: "running",
      condition: JSON.stringify({ country: "US" }),
    }),
  user: {
    opening: "Remove the country condition from the checkout redesign test.",
    instructions:
      "You want the Checkout redesign experiment to include users from every country. If the assistant explains a trade-off and asks how to release the change, go with the option it recommends. Don't volunteer anything else.",
  },
  confirmCards: "approve",
  expect: {
    plan: "in-place",
    phase: { condition: sameAudience({}, COUNTRIES) },
    judge: ["askedOnlyUserDecisions"],
  },
});
