/**
 * Compares judges for the built-in AI quality checks (hypothesis quality and
 * metric alignment) on hand-labelled cases: the current AI judge, a chat
 * model prompted the way production prompts it, and a decision model (Jev
 * through TypeSafe's System One API).
 *
 * Usage (from packages/back-end):
 *   pnpm exec tsx src/scripts/quality-judge-trial.ts [--cases file.json]
 *     [--llm claude-sonnet-5-5] [--skip-llm] [--out results.json]
 *   pnpm exec tsx src/scripts/quality-judge-trial.ts export --limit 50
 *     --out cases.json   (unlabelled cases from the local database)
 *
 * A case: { id, hypothesis, goalMetrics: string[],
 *   labels: { hypothesis: 0 | 0.5 | 1, alignment?: 0 | 0.5 | 1 } }
 * 0 = missing or unrelated, 0.5 = adequate but vague, 1 = exemplary.
 *
 * Running a trial sends the cases' text to TypeSafe and the chat model's
 * provider. Don't put customer data in a cases file without approval.
 */
import "back-end/src/init/dotenv";
import fs from "fs";
import os from "os";
import path from "path";
import { MongoClient } from "mongodb";
import { generateText, Output } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { z } from "zod";
import {
  AI_PROMPT_DEFAULTS,
  AIModel,
  CLOUD_MANAGED_AI_MODEL,
  getProviderFromModel,
} from "shared/ai";
import {
  ANTHROPIC_API_KEY,
  MONGODB_URI,
  OPENAI_API_KEY,
} from "back-end/src/util/secrets";
import {
  QUALITY_DECISION_MODEL,
  judgeQualityWithDecisionModel,
} from "back-end/src/enterprise/services/decisionModel";

type Label = 0 | 0.5 | 1;
type TrialCase = {
  id: string;
  hypothesis: string;
  goalMetrics: string[];
  labels: { hypothesis: Label | null; alignment?: Label | null };
};
type Check = "hypothesis" | "alignment";
type Verdicts = Partial<Record<Check, { score: number; reason: string }>>;
type JudgeRun = { verdicts: Verdicts; ms: number; inputTokens: number };

// Jev's price per input token (output is free)
const JEV_USD_PER_INPUT_TOKEN = 0.042 / 1_000_000;
const CONCURRENCY = 4;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

// --- Judges ------------------------------------------------------------------

async function runDecisionModel(c: TrialCase): Promise<JudgeRun> {
  const start = Date.now();
  const { verdicts, inputTokens } = await judgeQualityWithDecisionModel({
    hypothesis: c.hypothesis,
    goalMetricNames: c.goalMetrics,
  });
  return {
    verdicts: {
      hypothesis: verdicts["ai-hypothesis-quality"],
      alignment: verdicts["ai-hypothesis-metric-alignment"],
    },
    ms: Date.now() - start,
    inputTokens,
  };
}

const llmVerdict = z.object({
  score: z.number().min(0).max(1),
  reason: z.string(),
});
// Nullable rather than optional: OpenAI's strict output needs every key
const llmSchema = z.object({
  hypothesisQuality: llmVerdict.nullable(),
  hypothesisMetricAlignment: llmVerdict.nullable(),
});

function getChatModel(model: AIModel) {
  const provider = getProviderFromModel(model);
  if (provider === "anthropic") {
    return createAnthropic({ apiKey: ANTHROPIC_API_KEY })(model);
  }
  if (provider === "openai")
    return createOpenAI({ apiKey: OPENAI_API_KEY })(model);
  throw new Error(
    `The trial supports Anthropic and OpenAI models, not ${model}`,
  );
}

// Mirrors the production prompt in enterprise/services/experimentQualityScore.ts
// for an org on the default prompts
async function runChatModel(c: TrialCase, model: AIModel): Promise<JudgeRun> {
  const dimensions = [
    "- hypothesisQuality: score the hypothesis quality" +
      `\n  Judge the hypothesis against this definition of a good hypothesis: ${AI_PROMPT_DEFAULTS["experiment-hypothesis"]}`,
    ...(c.goalMetrics.length
      ? [
          "- hypothesisMetricAlignment: score how well the goal metrics measure what the hypothesis predicts",
        ]
      : []),
  ];
  const start = Date.now();
  const result = await generateText({
    model: getChatModel(model),
    system: AI_PROMPT_DEFAULTS["experiment-quality"],
    prompt: [
      `Hypothesis: ${c.hypothesis}`,
      c.goalMetrics.length ? `Goal metrics: ${c.goalMetrics.join(", ")}` : "",
      `Score ONLY these dimensions:\n${dimensions.join("\n")}`,
    ]
      .filter(Boolean)
      .join("\n\n"),
    temperature: 0.1,
    output: Output.object({ schema: llmSchema }),
  });
  return {
    verdicts: {
      hypothesis: result.output.hypothesisQuality ?? undefined,
      alignment: result.output.hypothesisMetricAlignment ?? undefined,
    },
    ms: Date.now() - start,
    inputTokens: result.usage.inputTokens ?? 0,
  };
}

// --- Scoring -----------------------------------------------------------------

type CheckStats = {
  n: number;
  absError: number;
  levelMatches: number;
  falsePass: number;
  falseFail: number;
};

const PASS = 0.5;
const nearestLevel = (score: number): Label =>
  score < 0.25 ? 0 : score < 0.75 ? 0.5 : 1;

function summarize(
  cases: TrialCase[],
  runs: Map<string, JudgeRun>,
): Record<Check, CheckStats> {
  const stats = {} as Record<Check, CheckStats>;
  for (const check of ["hypothesis", "alignment"] as const) {
    const s: CheckStats = {
      n: 0,
      absError: 0,
      levelMatches: 0,
      falsePass: 0,
      falseFail: 0,
    };
    for (const c of cases) {
      const label = c.labels[check];
      const score = runs.get(c.id)?.verdicts[check]?.score;
      if (label === null || label === undefined || score === undefined) {
        continue;
      }
      s.n++;
      s.absError += Math.abs(score - label);
      if (nearestLevel(score) === label) s.levelMatches++;
      if (label === 0 && score >= PASS) s.falsePass++;
      if (label > 0 && score < PASS) s.falseFail++;
    }
    stats[check] = s;
  }
  return stats;
}

const percentile = (values: number[], p: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return (
    sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0
  );
};

function printReport(
  name: string,
  cases: TrialCase[],
  runs: Map<string, JudgeRun>,
  usdPerInputToken?: number,
) {
  const stats = summarize(cases, runs);
  const all = [...runs.values()];
  const tokens = all.reduce((sum, r) => sum + r.inputTokens, 0);
  console.log(`\n${name} (${all.length} of ${cases.length} cases)`);
  for (const check of ["hypothesis", "alignment"] as const) {
    const s = stats[check];
    if (!s.n) continue;
    console.log(
      `  ${check.padEnd(10)} level match ${((100 * s.levelMatches) / s.n).toFixed(0)}%` +
        ` · mean error ${(s.absError / s.n).toFixed(2)}` +
        ` · false pass ${s.falsePass} · false fail ${s.falseFail} (n=${s.n})`,
    );
  }
  const ms = all.map((r) => r.ms);
  console.log(
    `  latency p50 ${percentile(ms, 0.5)} ms · p95 ${percentile(ms, 0.95)} ms · ` +
      `${Math.round(tokens / Math.max(all.length, 1))} input tokens per case` +
      (usdPerInputToken !== undefined
        ? ` · $${((tokens * usdPerInputToken * 10_000) / Math.max(all.length, 1)).toFixed(2)} per 10,000 experiments`
        : ""),
  );
}

async function runAll(
  cases: TrialCase[],
  judge: (c: TrialCase) => Promise<JudgeRun>,
): Promise<Map<string, JudgeRun>> {
  const runs = new Map<string, JudgeRun>();
  let next = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (next < cases.length) {
        const c = cases[next++];
        try {
          runs.set(c.id, await judge(c));
        } catch (e) {
          console.error(`  ${c.id} failed: ${(e as Error).message}`);
        }
      }
    }),
  );
  return runs;
}

// --- Commands ----------------------------------------------------------------

async function trial() {
  const casesPath =
    arg("cases") ?? path.join(__dirname, "quality-judge-trial.cases.json");
  const cases: TrialCase[] = JSON.parse(fs.readFileSync(casesPath, "utf8"));
  const llm = (arg("llm") ?? CLOUD_MANAGED_AI_MODEL) as AIModel;

  console.log(`Judging ${cases.length} cases from ${casesPath}`);
  const decision = await runAll(cases, runDecisionModel);
  printReport(
    `Decision model (${QUALITY_DECISION_MODEL})`,
    cases,
    decision,
    JEV_USD_PER_INPUT_TOKEN,
  );

  let chat: Map<string, JudgeRun> | null = null;
  if (!process.argv.includes("--skip-llm")) {
    chat = await runAll(cases, (c) => runChatModel(c, llm));
    printReport(`Current AI judge (${llm})`, cases, chat);
  }

  const out =
    arg("out") ?? path.join(os.tmpdir(), "quality-judge-trial.results.json");
  fs.writeFileSync(
    out,
    JSON.stringify(
      cases.map((c) => ({
        ...c,
        decisionModel: decision.get(c.id)?.verdicts,
        chatModel: chat?.get(c.id)?.verdicts,
      })),
      null,
      2,
    ),
  );
  console.log(`\nPer-case results: ${out}`);
}

// Unlabelled cases from the local database, to label by hand
async function exportCases() {
  const limit = Number(arg("limit") ?? 50);
  const out =
    arg("out") ?? path.join(os.tmpdir(), "quality-judge-trial.cases.json");
  const client = await MongoClient.connect(MONGODB_URI);
  try {
    const db = client.db();
    const experiments = await db
      .collection("experiments")
      .find({ hypothesis: { $nin: ["", null] }, archived: { $ne: true } })
      .project({ id: 1, hypothesis: 1, goalMetrics: 1 })
      .sort({ dateCreated: -1 })
      .limit(limit)
      .toArray();
    const metricIds = [
      ...new Set(experiments.flatMap((e) => e.goalMetrics ?? [])),
    ];
    const named = [
      ...(await db
        .collection("metrics")
        .find({ id: { $in: metricIds } })
        .project({ id: 1, name: 1 })
        .toArray()),
      ...(await db
        .collection("factmetrics")
        .find({ id: { $in: metricIds } })
        .project({ id: 1, name: 1 })
        .toArray()),
    ];
    const names = new Map(named.map((m) => [m.id, m.name]));
    const cases: TrialCase[] = experiments.map((e) => ({
      id: e.id,
      hypothesis: e.hypothesis,
      goalMetrics: (e.goalMetrics ?? [])
        .map((id: string) => names.get(id))
        .filter(Boolean),
      labels: { hypothesis: null, alignment: null },
    }));
    fs.writeFileSync(out, JSON.stringify(cases, null, 2));
    console.log(`Wrote ${cases.length} unlabelled cases to ${out}`);
  } finally {
    await client.close();
  }
}

(process.argv[2] === "export" ? exportCases() : trial()).catch((e) => {
  console.error(e);
  process.exit(1);
});
