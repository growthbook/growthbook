import { execFileSync, spawn } from "child_process";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { z } from "zod";
import { callUsage, type Usage } from "./record";

// Every model call the harness makes for itself (the simulated user, the
// judge) and the Claude Code driver go through the `claude` CLI, signed in
// with the developer's own Claude login. No API key is read or passed.

// The CLI finds its login in the OS keychain, which needs the user's identity
// but nothing else from the developer's shell, and in CLAUDE_CONFIG_DIR when
// the developer moved it.
export function claudeEnv(extra: Record<string, string> = {}) {
  const pick = (name: string) =>
    process.env[name] ? { [name]: process.env[name] as string } : {};
  return {
    PATH: process.env.PATH ?? "",
    HOME: process.env.HOME ?? "",
    LANG: process.env.LANG ?? "en_US.UTF-8",
    SHELL: "/bin/bash",
    ...pick("USER"),
    ...pick("LOGNAME"),
    ...pick("TMPDIR"),
    ...pick("CLAUDE_CONFIG_DIR"),
    ...extra,
  };
}

// Keeps the developer's settings, hooks, plugins, CLAUDE.md, and MCP servers
// out of the session, and file tools inside its working directory.
export const FENCE_FLAGS = ["--restricted", "--strict-mcp-config"];

export function assertClaudeLogin(): string {
  let status: { loggedIn?: boolean };
  let version: string;
  // The same environment the real calls get, so the check sees their login.
  const options = { encoding: "utf8" as const, env: claudeEnv() };
  try {
    version = execFileSync("claude", ["--version"], options)
      .trim()
      .split(" ")[0];
    status = JSON.parse(execFileSync("claude", ["auth", "status"], options));
  } catch {
    throw new Error(
      "The evals call the `claude` CLI. Install Claude Code and log in.",
    );
  }
  if (!status.loggedIn) {
    throw new Error("Log in to Claude Code (`claude`, then /login) first.");
  }
  return version;
}

const resultSchema = z.object({
  is_error: z.boolean(),
  result: z.string().optional(),
  structured_output: z.unknown().optional(),
  total_cost_usd: z.number().optional(),
  usage: z
    .object({
      input_tokens: z.number(),
      output_tokens: z.number(),
      cache_read_input_tokens: z.number().optional(),
      cache_creation_input_tokens: z.number().optional(),
    })
    .optional(),
});

// One prompt, no tools, nothing saved: what the simulator and judge need.
export async function askClaude<T>({
  model,
  system,
  prompt,
  schema,
}: {
  model: string;
  system: string;
  prompt: string;
  schema?: z.ZodType<T>;
}): Promise<{ text: string; output: T | null; usage: Usage }> {
  const args = [
    "-p",
    "--output-format",
    "json",
    "--no-session-persistence",
    "--tools",
    "",
    ...FENCE_FLAGS,
    "--model",
    model,
    "--system-prompt",
    system,
    ...(schema
      ? [
          "--json-schema",
          JSON.stringify(z.toJSONSchema(schema, { target: "draft-7" })),
        ]
      : []),
  ];
  // An empty directory, so the call never picks up a project's CLAUDE.md.
  // Removed here: exit listeners registered under Jest never fire.
  const cwd = mkdtempSync(path.join(tmpdir(), "gb-eval-claude-"));
  const stdout = await new Promise<string>((resolve, reject) => {
    const child = spawn("claude", args, { cwd, env: claudeEnv() });
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk: Buffer) => (out += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (err += chunk.toString()));
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0
        ? resolve(out)
        : reject(
            new Error(`claude exited ${code}: ${(err || out).slice(-500)}`),
          ),
    );
    child.stdin.end(prompt);
  }).finally(() => rmSync(cwd, { recursive: true, force: true }));
  const result = resultSchema.parse(JSON.parse(stdout));
  if (result.is_error) {
    throw new Error(`claude failed: ${result.result ?? "no message"}`);
  }
  const tokens = result.usage;
  return {
    text: result.result ?? "",
    output: schema ? schema.parse(result.structured_output) : null,
    usage: callUsage(
      tokens &&
        tokens.input_tokens +
          (tokens.cache_read_input_tokens ?? 0) +
          (tokens.cache_creation_input_tokens ?? 0),
      tokens?.output_tokens,
      result.total_cost_usd,
    ),
  };
}
