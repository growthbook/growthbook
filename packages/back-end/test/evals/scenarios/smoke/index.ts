import type { Suite } from "back-end/test/evals/harness/scenario";
import stopWithWinner from "./01-stop-with-winner";
import startDraft from "./02-start-draft";
import readResults from "./03-read-results";

// Flows agents already handle today, so a failure points at the harness
// before it points at the agent.
export const smokeSuite: Suite = {
  name: "smoke",
  threshold: 0.9,
  scenarios: [stopWithWinner, startDraft, readResults],
};
