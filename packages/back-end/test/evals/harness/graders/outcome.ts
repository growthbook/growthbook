import type { Scenario } from "back-end/test/evals/harness/scenario";
import type {
  ApiCall,
  WorldSnapshot,
} from "back-end/test/evals/harness/record";
import { DEFAULT_CALL_RULES, gradeCalls } from "./calls";
import { gradeState, type GradeResult } from "./state";

// The deterministic graders: what the agent left behind and which writes it
// made. Shared by live trials and the key-free replay in `pnpm test`.
export function gradeOutcome(
  scenario: Scenario,
  calls: ApiCall[],
  before: WorldSnapshot,
  after: WorldSnapshot,
): { state: GradeResult; calls: GradeResult } {
  return {
    state: gradeState(scenario.expect, before, after),
    calls: gradeCalls(
      [...DEFAULT_CALL_RULES, ...(scenario.expect.forbiddenCalls ?? [])],
      calls,
      before,
    ),
  };
}
