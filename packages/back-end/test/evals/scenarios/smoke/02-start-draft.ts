import { defineScenario } from "back-end/test/evals/harness/scenario";

export default defineScenario({
  id: "smoke-02",
  title: "Start a draft",
  tags: ["smoke", "lifecycle"],
  seed: (world) => world.experiment({ status: "draft" }),
  user: {
    opening: "Start the checkout redesign experiment.",
    instructions:
      "You want the Checkout redesign experiment running now, with its current settings. If the assistant mentions unfinished pre-launch checklist items, tell it to start anyway. Don't ask for any other change.",
  },
  confirmCards: "approve",
  expect: {
    plan: "start",
    experiment: { status: "running" },
    judge: ["askedOnlyUserDecisions"],
  },
  referenceActions: ({ experimentId }) => [
    {
      method: "POST",
      path: `/api/v1/experiments/${experimentId}/start`,
      body: { skipChecklist: true },
    },
  ],
});
