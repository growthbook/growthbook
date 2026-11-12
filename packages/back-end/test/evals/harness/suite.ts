import path from "path";
import { readEvalConfig, type EvalConfig } from "./config";
import { createDriverFactory } from "./drivers";
import { assertClaudeLogin } from "./claude-cli";
import { RESULTS_ROOT, runMetadata } from "./metadata";
import {
  formatReport,
  summarize,
  writeSummary,
  writeTrial,
  type SuiteSummary,
} from "./report";
import { runTrials, type TrialOutcome } from "./run-trials";
import type { Scenario, Suite } from "./scenario";

function selectScenarios(suite: Suite, config: EvalConfig): Scenario[] {
  return suite.scenarios.filter(
    (s) =>
      (!config.scenarioIds || config.scenarioIds.includes(s.id)) &&
      (!config.tag || s.tags.includes(config.tag)),
  );
}

function progress(outcome: TrialOutcome): string {
  const label = `${outcome.scenarioId} #${outcome.trial}`;
  switch (outcome.kind) {
    case "harness-error":
      return `  ! ${label} harness error`;
    case "invalid":
      return `  ? ${label} simulator broke character; not counted`;
    case "graded":
      return `  ${outcome.verdict.pass ? "✓" : "✗"} ${label} ${(outcome.record.durationMs / 1000).toFixed(0)}s`;
  }
}

// Runs live trials, writes every trial and the summary under .results/, and
// prints the report. The caller fails the run when `passed` is false.
export async function runSuite(
  suite: Suite,
  config: EvalConfig = readEvalConfig(),
): Promise<SuiteSummary> {
  const scenarios = selectScenarios(suite, config);
  if (!scenarios.length) {
    throw new Error(
      `No ${suite.name} scenarios match the --scenario/--tag filter`,
    );
  }
  assertClaudeLogin();
  const factory = createDriverFactory(config);
  const runId = `${new Date().toISOString().replace(/[:.]/g, "-")}-${suite.name}`;
  const resultsDir = path.join(RESULTS_ROOT, runId);

  process.stdout.write(
    `${suite.name}: ${scenarios.length} scenarios × ${config.trials} trials on ${factory.name} (${factory.profile})\n`,
  );
  let outcomes: TrialOutcome[];
  try {
    outcomes = await runTrials(scenarios, factory, config, (outcome) => {
      writeTrial(resultsDir, outcome);
      process.stdout.write(`${progress(outcome)}\n`);
    });
  } finally {
    await factory.close?.();
  }

  const driverMetadata = factory.metadata();
  const summary = summarize(
    {
      ...runMetadata(config.skillsSrc),
      runId,
      suite: suite.name,
      driver: factory.name,
      profile: factory.profile,
      driverMetadata,
      models: {
        // External harnesses pick their own model unless --model says.
        agent: driverMetadata.agentModel ?? config.agentModel,
        simulator: config.simulatorModel,
        judge: config.judgeModel,
      },
      k: config.trials,
      threshold: config.threshold ?? suite.threshold,
    },
    scenarios,
    outcomes,
    resultsDir,
  );
  writeSummary(summary);
  process.stdout.write(`\n${formatReport(summary, outcomes)}\n`);
  return summary;
}
