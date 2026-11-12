import type { Suite } from "back-end/test/evals/harness/scenario";
import mc01 from "./01-raise-traffic";
import mc02 from "./02-cut-traffic-sticky";
import mc03 from "./03-cut-traffic-no-sticky";
import mc04 from "./04-change-weights";
import mc05 from "./05-narrow-targeting-sticky";
import mc06 from "./06-broaden-targeting";
import mc07 from "./07-move-to-namespace";
import mc08 from "./08-new-phase";
import mc09 from "./09-bandit-narrow-targeting";
import mc10 from "./10-weights-accept-bias";
import mc11 from "./11-draft-traffic";
import mc12 from "./12-keep-assignments-without-sticky";

// The Make Changes PRD's launch benchmark: an agent with GrowthBook's skills
// must leave each experiment the way the Make Changes wizard would.
export const makeChangesSuite: Suite = {
  name: "make-changes",
  threshold: 0.9,
  scenarios: [
    mc01,
    mc02,
    mc03,
    mc04,
    mc05,
    mc06,
    mc07,
    mc08,
    mc09,
    mc10,
    mc11,
    mc12,
  ],
};
