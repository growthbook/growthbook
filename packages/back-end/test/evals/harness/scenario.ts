import type { CallRule } from "./graders/calls";
import type { JudgeCriterion } from "./graders/criteria";
import type { StateExpectation } from "./graders/state";
import type { Seeded, World } from "./world";

// A request the ideal agent would send. Replayed key-free in `pnpm test` to
// prove the seed is right and that the graders accept the correct outcome.
export interface ReferenceAction {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  query?: Record<string, string>;
  body?: unknown;
  // For a call the ideal agent expects to be refused, such as a dry run that
  // tells it a plan can't run. Defaults to any 2xx.
  expectStatus?: number;
}

export interface ScenarioUser {
  // The first message, sent verbatim.
  opening: string;
  // What the simulated user wants and knows, hidden from the agent.
  instructions: string;
}

export interface ScenarioExpect extends StateExpectation {
  // Added to the default call rules.
  forbiddenCalls?: CallRule[];
  judge?: JudgeCriterion[];
}

export interface Scenario {
  id: string;
  title: string;
  tags: string[];
  seed: (world: World) => Promise<Seeded>;
  user: ScenarioUser;
  // How the user answers confirm cards. Only drivers with cards ask.
  confirmCards: "approve" | "reject";
  // Messages plus card decisions the user sends before the trial is cut off.
  maxTurns: number;
  expect: ScenarioExpect;
  referenceActions: (seeded: Seeded) => ReferenceAction[];
}

export function defineScenario(
  scenario: Omit<Scenario, "maxTurns" | "referenceActions"> &
    Partial<Pick<Scenario, "maxTurns" | "referenceActions">>,
): Scenario {
  return { maxTurns: 6, referenceActions: () => [], ...scenario };
}

export interface Suite {
  name: string;
  // The suite pass rate a run must reach.
  threshold: number;
  scenarios: Scenario[];
}
