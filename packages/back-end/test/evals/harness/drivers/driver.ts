import type { DriverEvidence } from "back-end/test/evals/harness/record";
import type { World } from "back-end/test/evals/harness/world";

// Where the agent stopped and handed control back to the user.
export type AgentTurn =
  | { kind: "reply"; text: string }
  | { kind: "ask"; question: string; options: string[] }
  | { kind: "confirm"; summary: string }
  | { kind: "error"; message: string };

// One conversation with one agent, inside one trial's world.
export interface Driver {
  start(opening: string): Promise<AgentTurn>;
  reply(message: string): Promise<AgentTurn>;
  // Only drivers whose agent shows confirm cards implement this.
  decide?(decision: "confirm" | "cancel"): Promise<AgentTurn>;
  finish(): Promise<DriverEvidence>;
}

// Builds a driver per trial. Long-lived resources (an eval server, say) live
// here and are released by `close`.
export interface DriverFactory {
  name: string;
  profile: string;
  // Recorded with the run so results can be compared across runs.
  metadata(): Record<string, string>;
  create(world: World): Promise<Driver>;
  close?(): Promise<void>;
}
