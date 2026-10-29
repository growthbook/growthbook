import { defineScenario } from "back-end/test/evals/harness/scenario";
import { sameAudience } from "back-end/test/evals/harness/graders/matchers";
import { COUNTRIES } from "./audiences";

export default defineScenario({
  id: "mc-05",
  title: "Narrow targeting to the US, sticky bucketing on",
  tags: ["make-changes", "targeting", "release-plan"],
  seed: (world) =>
    world.experiment({ status: "running", stickyBucketing: true }),
  user: {
    opening: "Only target US users in the checkout redesign test.",
    instructions:
      "You want the Checkout redesign experiment to include only users whose country is the US. If the assistant explains a trade-off and asks how to release the change, go with the option it recommends. Don't volunteer anything else.",
  },
  confirmCards: "approve",
  expect: {
    plan: "same-phase-keep-assignments",
    phase: {
      condition: sameAudience({ country: "US" }, COUNTRIES),
    },
    judge: ["tradeOffPresentedBeforeCommit", "askedOnlyUserDecisions"],
  },
});
