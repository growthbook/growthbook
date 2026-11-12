import type { EvalConfig } from "./config";
import type { VisibleEvent } from "./conversation";
import type { DriverFactory } from "./drivers/driver";
import { judgeTrial, type JudgeVerdict } from "./graders/judge";
import { gradeOutcome } from "./graders/outcome";
import type { GradeResult } from "./graders/state";
import {
  addUsage,
  emptyUsage,
  type EndReason,
  type TrialRecord,
  type Usage,
} from "./record";
import type { Scenario } from "./scenario";
import { simulateUser } from "./user-simulator";
import { createWorld } from "./world";

export interface TrialVerdict {
  pass: boolean;
  state: GradeResult;
  calls: GradeResult;
  judge: JudgeVerdict;
}

export type TrialOutcome = {
  scenarioId: string;
  trial: number;
  // Attempts thrown away because the simulated user broke character.
  discarded: number;
  // What the agent cost across every attempt, discarded ones included.
  agentUsage: Usage;
  // What the simulator and judge cost, on top of the agent.
  evalUsage: Usage;
} & (
  | { kind: "graded"; record: TrialRecord; verdict: TrialVerdict }
  // The simulator broke character on every attempt.
  | { kind: "invalid"; record: TrialRecord; verdict: TrialVerdict }
  // The record holds what the agent did before the harness failed, once a
  // conversation had started.
  | { kind: "harness-error"; error: string; record: TrialRecord | null }
);

type Attempt =
  | {
      kind: "graded";
      record: TrialRecord;
      verdict: TrialVerdict;
      evalUsage: Usage;
    }
  | {
      kind: "failed";
      error: string;
      record: TrialRecord;
      evalUsage: Usage;
    };

const MAX_ATTEMPTS = 3;

const errorText = (e: unknown) =>
  e instanceof Error ? (e.stack ?? e.message) : String(e);

// Throws only before the conversation starts or while collecting its
// evidence; after that, a failure comes back with the record so far.
async function attempt(
  scenario: Scenario,
  factory: DriverFactory,
  config: EvalConfig,
): Promise<Attempt> {
  const world = await createWorld({ agentModel: config.agentModel });
  const target = await scenario.seed(world);
  const before = await world.read(target);
  const driver = await factory.create(world);
  const started = Date.now();

  const conversation: VisibleEvent[] = [
    { from: "user", text: scenario.user.opening },
  ];
  let evalUsage = emptyUsage();
  let turns = 0;
  let endReason: EndReason = "harness-error";
  let failure: { error: unknown } | null = null;
  try {
    let turn = await driver.start(scenario.user.opening);
    for (;;) {
      conversation.push({ from: "agent", turn });
      if (turn.kind === "error") {
        endReason = "agent-error";
        break;
      }
      if (turns >= scenario.maxTurns) {
        endReason = "max-turns";
        break;
      }
      if (turn.kind === "confirm" && driver.decide) {
        const decision =
          scenario.confirmCards === "approve" ? "confirm" : "cancel";
        conversation.push({ from: "user", decision });
        turns++;
        turn = await driver.decide(decision);
        continue;
      }
      const simulated = await simulateUser(
        config.simulatorModel,
        scenario.user,
        conversation,
      );
      evalUsage = addUsage(evalUsage, simulated.usage);
      if (simulated.reply.stop) {
        endReason = "user-stopped";
        break;
      }
      conversation.push({ from: "user", text: simulated.reply.text });
      turns++;
      turn = await driver.reply(simulated.reply.text);
    }
  } catch (e) {
    failure = { error: e };
  }

  const evidence = await driver.finish();
  const record: TrialRecord = {
    ...evidence,
    before,
    after: await world.read(target),
    turns,
    endReason,
    durationMs: Date.now() - started,
  };
  const failed = (e: unknown): Attempt => ({
    kind: "failed",
    error: errorText(e),
    record,
    evalUsage,
  });
  if (failure) return failed(failure.error);

  const outcome = gradeOutcome(scenario, record.calls, before, record.after);
  try {
    const judge = await judgeTrial(
      config.judgeModel,
      scenario.user,
      record.transcript,
      scenario.expect.judge ?? [],
    );
    return {
      kind: "graded",
      record,
      verdict: {
        pass: outcome.state.pass && outcome.calls.pass && judge.pass,
        ...outcome,
        judge,
      },
      evalUsage: addUsage(evalUsage, judge.usage),
    };
  } catch (e) {
    return failed(e);
  }
}

export async function runTrial(
  scenario: Scenario,
  trial: number,
  factory: DriverFactory,
  config: EvalConfig,
): Promise<TrialOutcome> {
  let agentUsage = emptyUsage();
  let evalUsage = emptyUsage();
  let discarded = 0;
  const base = { scenarioId: scenario.id, trial };
  const harnessError = (
    error: string,
    record: TrialRecord | null,
  ): TrialOutcome => ({
    ...base,
    kind: "harness-error",
    discarded,
    agentUsage,
    evalUsage,
    error,
    record,
  });
  try {
    for (;;) {
      const result = await attempt(scenario, factory, config);
      agentUsage = addUsage(agentUsage, result.record.usage);
      evalUsage = addUsage(evalUsage, result.evalUsage);
      if (result.kind === "failed") {
        return harnessError(result.error, result.record);
      }
      const valid = result.verdict.judge.simulatorValid;
      if (valid || discarded + 1 === MAX_ATTEMPTS) {
        return {
          ...base,
          kind: valid ? "graded" : "invalid",
          discarded,
          agentUsage,
          evalUsage,
          record: result.record,
          verdict: result.verdict,
        };
      }
      discarded++;
    }
  } catch (e) {
    return harnessError(errorText(e), null);
  }
}

// Runs every scenario `trials` times, at most `concurrency` trials at once.
export async function runTrials(
  scenarios: Scenario[],
  factory: DriverFactory,
  config: EvalConfig,
  onOutcome: (outcome: TrialOutcome) => void,
): Promise<TrialOutcome[]> {
  const queue = scenarios.flatMap((scenario) =>
    Array.from({ length: config.trials }, (_, i) => ({
      scenario,
      trial: i + 1,
    })),
  );
  const outcomes: TrialOutcome[] = [];
  const worker = async () => {
    for (let job = queue.shift(); job; job = queue.shift()) {
      const outcome = await runTrial(job.scenario, job.trial, factory, config);
      outcomes.push(outcome);
      onOutcome(outcome);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(config.concurrency, queue.length) }, worker),
  );
  return outcomes;
}
