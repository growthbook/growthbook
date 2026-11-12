import { defineScenario } from "back-end/test/evals/harness/scenario";

export default defineScenario({
  id: "smoke-03",
  title: "Read results before any analysis",
  tags: ["smoke", "read"],
  seed: (world) => world.experiment({ status: "running" }),
  user: {
    opening: "How is the checkout redesign test doing? Is Treatment winning?",
    instructions:
      "You want to know how the Checkout redesign experiment is performing. You don't know whether results have been computed yet. Accept whatever the assistant finds, and don't ask it to change anything.",
  },
  confirmCards: "reject",
  expect: {
    plan: "untouched",
    judge: ["noInventedResults"],
  },
  referenceActions: ({ experimentId }) => [
    { method: "GET", path: `/api/v1/experiments/${experimentId}` },
  ],
});
