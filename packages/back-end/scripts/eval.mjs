#!/usr/bin/env node
// Runs a live agent eval suite:
//   pnpm --filter back-end eval <suite> [--trials 3] [--scenario mc-03,mc-04]
//     [--tag release-plan] [--model claude-sonnet-5-5] [--driver in-app]
//     [--profile skills] [--concurrency 4] [--threshold 0.9] [--skip-assemble]
//     [--mcp-server ../growthbook-mcp]
// Drivers and their profiles:
//   in-app       skills (default), no-skills
//   claude-code  mcp (default), mcp-api, plugin, bare. Runs the `claude` CLI
//                against a local eval server; needs ANTHROPIC_API_KEY. --model
//                is passed through only when given (aliases like opus work).
//                --mcp-server points the mcp profiles at a built
//                growthbook-mcp checkout instead of the published package.
// Skills come from wherever assemble-skills resolves them ($SKILLS_SRC,
// agent-skills.local.json, or skills-src/), so a playbook branch is tested by
// pointing at it; the claude-code plugin profile loads that checkout as its
// plugin. Flags reach the harness as EVAL_* variables because Jest rejects
// unknown CLI flags.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const FLAGS = {
  trials: "EVAL_TRIALS",
  scenario: "EVAL_SCENARIO",
  tag: "EVAL_TAG",
  model: "EVAL_MODEL",
  driver: "EVAL_DRIVER",
  profile: "EVAL_PROFILE",
  concurrency: "EVAL_CONCURRENCY",
  threshold: "EVAL_THRESHOLD",
  "simulator-model": "EVAL_SIMULATOR_MODEL",
  "judge-model": "EVAL_JUDGE_MODEL",
  "mcp-server": "EVAL_MCP_SERVER",
};

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    ...Object.fromEntries(
      Object.keys(FLAGS).map((name) => [name, { type: "string" }]),
    ),
    "skip-assemble": { type: "boolean" },
  },
});

const suite = positionals[0];
const suiteFile = join("test", "evals", `${suite}.eval.ts`);
if (!suite || !existsSync(join(packageRoot, suiteFile))) {
  process.stderr.write(
    "Usage: pnpm --filter back-end eval <smoke|make-changes> [flags]\n",
  );
  process.exit(2);
}

const run = (command, args, env = process.env) =>
  spawnSync(command, args, { cwd: packageRoot, stdio: "inherit", env })
    .status ?? 1;

if (!values["skip-assemble"]) {
  const status = run("node", ["scripts/assemble-agent-skills.mjs"]);
  if (status !== 0) process.exit(status);
}

const env = { ...process.env };
for (const [name, variable] of Object.entries(FLAGS)) {
  if (values[name] !== undefined) env[variable] = values[name];
}
env.DISABLE_PYTHON_MONITOR = "true";
env.GB_STATS_ENGINE_MIN_POOL_SIZE = "0";
env.NODE_OPTIONS = `${env.NODE_OPTIONS ?? ""} --no-node-snapshot --max-old-space-size=8192`;

process.exit(
  run(
    "jest",
    ["-c", "jest.evals.config.mjs", "--runInBand", "--forceExit", suiteFile],
    env,
  ),
);
