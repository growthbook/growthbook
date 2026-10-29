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
  // What the simulator and judge cost, on top of the agent.
  evalUsage: Usage;
} & (
  | { kind: "graded"; record: TrialRecord; verdict: TrialVerdict }
  // The simulator broke character on every attempt.
  | { kind: "invalid"; record: TrialRecord; verdict: TrialVerdict }
  | { kind: "harness-error"; error: string }
);

const MAX_ATTEMPTS = 3;

async function attempt(
  scenario: Scenario,
  factory: DriverFactory,
  config: EvalConfig,
): Promise<{ record: TrialRecord; verdict: TrialVerdict; evalUsage: Usage }> {
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
  let endReason: EndReason;
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

  const evidence = await driver.finish();
  const record: TrialRecord = {
    ...evidence,
    before,
    after: await world.read(target),
    turns,
    endReason,
    durationMs: Date.now() - started,
  };
  const outcome = gradeOutcome(scenario, record.calls, before, record.after);
  const judge = await judgeTrial(
    config.judgeModel,
    scenario.user,
    record.transcript,
    scenario.expect.judge ?? [],
  );
  return {
    record,
    verdict: {
      pass: outcome.state.pass && outcome.calls.pass && judge.pass,
      ...outcome,
      judge,
    },
    evalUsage: addUsage(evalUsage, judge.usage),
  };
}

export async function runTrial(
  scenario: Scenario,
  trial: number,
  factory: DriverFactory,
  config: EvalConfig,
): Promise<TrialOutcome> {
  let evalUsage = emptyUsage();
  const base = { scenarioId: scenario.id, trial };
  try {
    for (let n = 1; ; n++) {
      const result = await attempt(scenario, factory, config);
      evalUsage = addUsage(evalUsage, result.evalUsage);
      const valid = result.verdict.judge.simulatorValid;
      if (valid || n === MAX_ATTEMPTS) {
        return {
          ...base,
          kind: valid ? "graded" : "invalid",
          discarded: n - 1,
          evalUsage,
          record: result.record,
          verdict: result.verdict,
        };
      }
    }
  } catch (e) {
    return {
      ...base,
      kind: "harness-error",
      discarded: 0,
      evalUsage,
      error: e instanceof Error ? (e.stack ?? e.message) : String(e),
    };
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
