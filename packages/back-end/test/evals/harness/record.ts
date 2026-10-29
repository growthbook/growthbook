import type { ExperimentInterface } from "shared/types/experiment";

// What a person could see or do in the conversation, plus the agent's tool
// traffic. Each driver turns its own evidence into this shape, so graders
// never know which agent produced it.
export type TranscriptEvent =
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string }
  | { kind: "tool-call"; id: string; name: string; args: unknown }
  | {
      kind: "tool-result";
      id: string;
      name: string;
      result: unknown;
      isError: boolean;
    }
  | { kind: "ask"; question: string; options: string[] }
  | {
      kind: "confirm";
      summary: string;
      method: string;
      path: string;
      body?: unknown;
    }
  | { kind: "decision"; decision: "confirm" | "cancel" }
  | { kind: "error"; message: string };

export interface ApiCall {
  method: string;
  // Without the query string, e.g. "/api/v1/experiments/exp_123".
  path: string;
  query?: Record<string, string>;
  body?: unknown;
  status: number;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  // Spend for the calls that could be priced.
  costUsd: number;
  // Calls with no reported tokens, such as a turn cut off at a confirm card.
  unpricedCalls: number;
}

export const emptyUsage = (): Usage => ({
  inputTokens: 0,
  outputTokens: 0,
  costUsd: 0,
  unpricedCalls: 0,
});

export function addUsage(a: Usage, b: Usage): Usage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    costUsd: a.costUsd + b.costUsd,
    unpricedCalls: a.unpricedCalls + b.unpricedCalls,
  };
}

// One call's usage; unknown spend counts the call as unpriced.
export function callUsage(
  inputTokens: number | undefined,
  outputTokens: number | undefined,
  costUsd: number | undefined,
): Usage {
  return {
    inputTokens: inputTokens ?? 0,
    outputTokens: outputTokens ?? 0,
    costUsd: costUsd ?? 0,
    unpricedCalls: costUsd === undefined ? 1 : 0,
  };
}

export interface WorldSnapshot {
  experiment: ExperimentInterface | null;
  orgStickyBucketing: boolean;
}

// The driver's half of a trial record.
export interface DriverEvidence {
  transcript: TranscriptEvent[];
  calls: ApiCall[];
  usage: Usage;
  skillsLoaded: string[];
}

export type EndReason = "user-stopped" | "max-turns" | "agent-error";

export interface TrialRecord extends DriverEvidence {
  before: WorldSnapshot;
  after: WorldSnapshot;
  // Messages and confirm-card decisions the simulated user sent.
  turns: number;
  endReason: EndReason;
  durationMs: number;
}
