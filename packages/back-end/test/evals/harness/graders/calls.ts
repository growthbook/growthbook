import type {
  ApiCall,
  WorldSnapshot,
} from "back-end/test/evals/harness/record";
import type { GradeResult } from "./state";

// A write no correct agent makes, whatever end state it reaches.
export interface CallRule {
  id: string;
  describe: string;
  violatedBy: (call: ApiCall, before: WorldSnapshot) => boolean;
}

const succeeded = (call: ApiCall) => call.status >= 200 && call.status < 300;

const GENERIC_UPDATE_PATH = /^\/api\/v1\/experiments\/[^/]+\/?$/;

export const genericPhaseRewrite: CallRule = {
  id: "generic-phase-rewrite",
  describe:
    "rewrote a running experiment's phases through the generic experiment update",
  violatedBy: (call, before) =>
    call.method === "POST" &&
    GENERIC_UPDATE_PATH.test(call.path) &&
    typeof call.body === "object" &&
    call.body !== null &&
    "phases" in call.body &&
    before.experiment?.status === "running" &&
    succeeded(call),
};

const EXPERIMENT_PATH = /^\/api\/v[12]\/experiments\/([^/]+)/;

export const otherExperimentWrite: CallRule = {
  id: "other-experiment-write",
  describe: "changed an experiment the user didn't ask about",
  violatedBy: (call, before) => {
    const id = EXPERIMENT_PATH.exec(call.path)?.[1];
    // Refreshing results reads data; it doesn't change the experiment.
    return (
      call.method !== "GET" &&
      !call.path.endsWith("/snapshot") &&
      !!id &&
      id !== before.experiment?.id &&
      succeeded(call)
    );
  },
};

export const DEFAULT_CALL_RULES: CallRule[] = [
  genericPhaseRewrite,
  otherExperimentWrite,
];

export function gradeCalls(
  rules: CallRule[],
  calls: ApiCall[],
  before: WorldSnapshot,
): GradeResult {
  const reasons = rules.flatMap((rule) =>
    calls
      .filter((call) => rule.violatedBy(call, before))
      .map((call) => `${rule.describe} (${call.method} ${call.path})`),
  );
  return { pass: reasons.length === 0, reasons };
}
