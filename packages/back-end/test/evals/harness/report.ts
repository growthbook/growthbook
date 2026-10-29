import { mkdirSync, writeFileSync } from "fs";
import { homedir } from "os";
import path from "path";
import type { AIModel } from "shared/ai";
import type { RunMetadata, SourceVersion } from "./metadata";
import { addUsage, emptyUsage, type Usage } from "./record";
import type { TrialOutcome } from "./run-trials";
import type { Scenario } from "./scenario";
import { renderTranscript } from "./transcript";

export interface ScenarioSummary {
  id: string;
  title: string;
  // Trials that count: graded ones plus harness errors, which count as fails.
  trials: number;
  passes: number;
  // Estimated chance that k fresh trials all pass (τ-bench's pass^k).
  passHatK: number;
  state: number;
  calls: number;
  judge: number;
  avgTurns: number;
  agentUsage: Usage;
  // Trials the simulated user spoiled on every attempt; not counted.
  invalid: number;
  harnessErrors: number;
}

export interface RunInfo extends RunMetadata {
  runId: string;
  suite: string;
  driver: string;
  profile: string;
  driverMetadata: Record<string, string>;
  models: { agent: AIModel; simulator: AIModel; judge: AIModel };
  k: number;
  threshold: number;
}

export interface SuiteSummary extends RunInfo {
  passRate: number;
  passed: boolean;
  scenarios: ScenarioSummary[];
  agentUsage: Usage;
  evalUsage: Usage;
  resultsDir: string;
}

function choose(n: number, k: number): number {
  let r = 1;
  for (let i = 0; i < k; i++) r = (r * (n - i)) / (i + 1);
  return r;
}

export function passHatK(n: number, c: number, k: number): number {
  const kk = Math.min(k, n);
  return kk === 0 ? 0 : choose(c, kk) / choose(n, kk);
}

const sumUsage = (usages: Usage[]) => usages.reduce(addUsage, emptyUsage());

export function summarize(
  info: RunInfo,
  scenarios: Scenario[],
  outcomes: TrialOutcome[],
  resultsDir: string,
): SuiteSummary {
  const summaries = scenarios.map((scenario): ScenarioSummary => {
    const mine = outcomes.filter((o) => o.scenarioId === scenario.id);
    const graded = mine.flatMap((o) => (o.kind === "graded" ? [o] : []));
    const harnessErrors = mine.filter((o) => o.kind === "harness-error");
    const trials = graded.length + harnessErrors.length;
    const passes = graded.filter((o) => o.verdict.pass).length;
    return {
      id: scenario.id,
      title: scenario.title,
      trials,
      passes,
      passHatK: passHatK(trials, passes, info.k),
      state: graded.filter((o) => o.verdict.state.pass).length,
      calls: graded.filter((o) => o.verdict.calls.pass).length,
      judge: graded.filter((o) => o.verdict.judge.pass).length,
      avgTurns: graded.length
        ? graded.reduce((n, o) => n + o.record.turns, 0) / graded.length
        : 0,
      agentUsage: sumUsage(graded.map((o) => o.record.usage)),
      invalid: mine.filter((o) => o.kind === "invalid").length,
      harnessErrors: harnessErrors.length,
    };
  });
  const trials = summaries.reduce((n, s) => n + s.trials, 0);
  const passes = summaries.reduce((n, s) => n + s.passes, 0);
  const passRate = trials ? passes / trials : 0;
  return {
    ...info,
    passRate,
    passed: trials > 0 && passRate >= info.threshold,
    scenarios: summaries,
    agentUsage: sumUsage(summaries.map((s) => s.agentUsage)),
    evalUsage: sumUsage(outcomes.map((o) => o.evalUsage)),
    resultsDir,
  };
}

export function trialFileName(outcome: TrialOutcome): string {
  return `${outcome.scenarioId}-${outcome.trial}`;
}

// One JSON file per trial, written as soon as the trial ends, plus a readable
// transcript next to it.
export function writeTrial(dir: string, outcome: TrialOutcome): void {
  mkdirSync(dir, { recursive: true });
  const name = trialFileName(outcome);
  writeFileSync(
    path.join(dir, `${name}.json`),
    JSON.stringify(outcome, null, 2),
  );
  if (outcome.kind !== "harness-error") {
    const { verdict, record } = outcome;
    const reasons = [
      ...verdict.state.reasons.map((r) => `state: ${r}`),
      ...verdict.calls.reasons.map((r) => `calls: ${r}`),
      ...verdict.judge.reasons.map((r) => `judge: ${r}`),
    ];
    writeFileSync(
      path.join(dir, `${name}.md`),
      [
        `# ${name}: ${verdict.pass ? "PASS" : "FAIL"} (${outcome.kind})`,
        "",
        ...reasons.map((r) => `- ${r}`),
        ...(verdict.judge.simulatorValid
          ? []
          : [`- simulator: ${verdict.judge.simulatorReason}`]),
        "",
        `Ended: ${record.endReason} after ${record.turns} user turns. Skills loaded: ${record.skillsLoaded.join(", ") || "none"}.`,
        "",
        "```text",
        renderTranscript(record.transcript),
        "```",
        "",
      ].join("\n"),
    );
  }
}

export function writeSummary(summary: SuiteSummary): void {
  mkdirSync(summary.resultsDir, { recursive: true });
  writeFileSync(
    path.join(summary.resultsDir, "summary.json"),
    JSON.stringify(summary, null, 2),
  );
}

const money = (u: Usage) =>
  `$${u.costUsd.toFixed(2)}${u.unpricedCalls ? ` +${u.unpricedCalls} unpriced` : ""}`;
const sha = (v: SourceVersion) => `${v.sha ?? "?"}${v.dirty ? " (dirty)" : ""}`;
const home = (p: string) =>
  p.startsWith(homedir()) ? `~${p.slice(homedir().length)}` : p;

function table(rows: string[][]): string {
  const widths = rows[0].map((_, i) =>
    Math.max(...rows.map((r) => r[i].length)),
  );
  return rows
    .map((r) => r.map((cell, i) => cell.padEnd(widths[i])).join("  "))
    .join("\n");
}

export function formatReport(
  summary: SuiteSummary,
  outcomes: TrialOutcome[],
): string {
  const k = summary.k;
  const header = [
    summary.suite,
    `${summary.driver} (${summary.profile})`,
    `skills ${summary.skills ? `${home(summary.skills.path)} @ ${sha(summary.skills)}` : "none assembled"}`,
    `agent ${summary.models.agent}`,
    `growthbook @ ${sha(summary.growthbook)}`,
    `k=${k}`,
  ].join(" · ");
  const rows = [
    [
      "scenario",
      "pass",
      `pass^${k}`,
      "state",
      "calls",
      "judge",
      "turns",
      "cost",
    ],
    ...summary.scenarios.map((s) => {
      const of = (n: number) => `${n}/${s.trials}`;
      const notes = [
        s.invalid ? `${s.invalid} invalid` : "",
        s.harnessErrors ? `${s.harnessErrors} harness errors` : "",
      ].filter(Boolean);
      return [
        `${s.id} ${s.title}`.slice(0, 48),
        of(s.passes) + (notes.length ? ` (${notes.join(", ")})` : ""),
        s.passHatK.toFixed(2),
        of(s.state),
        of(s.calls),
        of(s.judge),
        s.avgTurns.toFixed(1),
        money(s.agentUsage),
      ];
    }),
  ];
  const failures = outcomes
    .filter((o) => o.kind !== "graded" || !o.verdict.pass)
    .sort((a, b) => trialFileName(a).localeCompare(trialFileName(b)))
    .map((o) => {
      const file = path.join(summary.resultsDir, trialFileName(o));
      if (o.kind === "harness-error") {
        return `  ${trialFileName(o)} harness error → ${file}.json\n    ${o.error.split("\n")[0]}`;
      }
      const reasons = [
        ...o.verdict.state.reasons.map((r) => `state: ${r}`),
        ...o.verdict.calls.reasons.map((r) => `calls: ${r}`),
        ...o.verdict.judge.reasons.map((r) => `judge: ${r}`),
        ...(o.kind === "invalid"
          ? [`simulator: ${o.verdict.judge.simulatorReason}`]
          : []),
      ];
      return [
        `  ${trialFileName(o)}${o.kind === "invalid" ? " (invalid, not counted)" : ""} → ${file}.md`,
        ...reasons.map((r) => `    ${r}`),
      ].join("\n");
    });
  return [
    header,
    table(rows),
    `suite pass rate ${summary.passRate.toFixed(2)} · threshold ${summary.threshold.toFixed(2)} · ${summary.passed ? "PASS" : "FAIL"}`,
    `agent cost ${money(summary.agentUsage)} · simulator and judge cost ${money(summary.evalUsage)}`,
    ...(failures.length ? ["", "Failed trials:", ...failures] : []),
    "",
    `results: ${summary.resultsDir}`,
  ].join("\n");
}
