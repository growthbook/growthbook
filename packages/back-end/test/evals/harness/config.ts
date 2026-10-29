import { getProviderFromModel, type AIModel } from "shared/ai";

// Everything a run can vary, read once from the environment the `eval`
// command sets from its flags.
export interface EvalConfig {
  trials: number;
  concurrency: number;
  scenarioIds: string[] | null;
  tag: string | null;
  driver: string;
  // Null means the driver's default.
  profile: string | null;
  agentModel: AIModel;
  simulatorModel: AIModel;
  judgeModel: AIModel;
  // Null means the suite's own threshold.
  threshold: number | null;
  skillsSrc: string | null;
}

function positiveInt(
  name: string,
  value: string | undefined,
  fallback: number,
) {
  if (value === undefined || value === "") return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`${name} must be a positive integer, got "${value}"`);
  }
  return n;
}

function model(name: string, value: string | undefined, fallback: AIModel) {
  const id = (value || fallback) as AIModel;
  try {
    getProviderFromModel(id);
  } catch {
    throw new Error(`${name}: ${id} isn't a model GrowthBook supports`);
  }
  return id;
}

function list(value: string | undefined): string[] | null {
  const items = (value ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return items.length ? items : null;
}

export function readEvalConfig(env = process.env): EvalConfig {
  const threshold = env.EVAL_THRESHOLD ? Number(env.EVAL_THRESHOLD) : null;
  if (threshold !== null && !(threshold >= 0 && threshold <= 1)) {
    throw new Error(`EVAL_THRESHOLD must be between 0 and 1`);
  }
  return {
    trials: positiveInt("EVAL_TRIALS", env.EVAL_TRIALS, 3),
    concurrency: positiveInt("EVAL_CONCURRENCY", env.EVAL_CONCURRENCY, 4),
    scenarioIds: list(env.EVAL_SCENARIO),
    tag: env.EVAL_TAG || null,
    driver: env.EVAL_DRIVER || "in-app",
    profile: env.EVAL_PROFILE || null,
    agentModel: model("EVAL_MODEL", env.EVAL_MODEL, "claude-sonnet-5-5"),
    simulatorModel: model(
      "EVAL_SIMULATOR_MODEL",
      env.EVAL_SIMULATOR_MODEL,
      "claude-sonnet-5-5",
    ),
    judgeModel: model(
      "EVAL_JUDGE_MODEL",
      env.EVAL_JUDGE_MODEL,
      "claude-opus-5-5",
    ),
    threshold,
    skillsSrc: env.SKILLS_SRC || null,
  };
}
