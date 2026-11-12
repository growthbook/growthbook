import { execFileSync, spawn, spawnSync } from "child_process";
import { existsSync } from "fs";
import { writeFile } from "fs/promises";
import path from "path";
import { createInterface } from "readline";
import { z } from "zod";
import {
  assertClaudeLogin,
  claudeEnv,
  FENCE_FLAGS,
} from "back-end/test/evals/harness/claude-cli";
import { versionOf } from "back-end/test/evals/harness/metadata";
import {
  addUsage,
  callUsage,
  emptyUsage,
  type TranscriptEvent,
  type Usage,
} from "back-end/test/evals/harness/record";
import type {
  ExternalProfile,
  Harness,
  HarnessAdapter,
  HarnessEnv,
  HarnessTurn,
} from "./adapter";

const MCP_PACKAGE = "@growthbook/mcp";
// The server's name in the MCP config, which prefixes its tools.
const MCP_NAME = "growthbook";
const READ_SKILL_TOOL = `mcp__${MCP_NAME}__growthbook_read_skill`;
const PLUGIN_NAME = "growthbook";
const TURN_TIMEOUT_MS = 15 * 60 * 1000;
// A runaway turn stops here instead of spending the run's budget.
const TURN_BUDGET_USD = 5;

export interface ClaudeCodeOptions {
  // --model, verbatim; null leaves Claude Code on its own default.
  model: string | null;
  // The skills checkout the run resolved; the plugin profile loads it.
  skillsSource: string | null;
  // A built growthbook-mcp checkout; null runs the published package.
  mcpServer: string | null;
}

// How a trial starts the GrowthBook MCP server, and what to record about it.
interface McpServerLaunch {
  command: string;
  args: string[];
  source: string;
}

function mcpServerLaunch(checkout: string | null): McpServerLaunch {
  if (checkout) {
    // Absolute, because Claude Code starts the server from the trial's dir.
    const root = path.resolve(checkout);
    const entry = path.join(root, "server", "index.js");
    if (!existsSync(entry)) {
      throw new Error(
        `EVAL_MCP_SERVER: ${entry} is missing. Run \`npm run build\` in the checkout.`,
      );
    }
    const { sha, dirty } = versionOf(root);
    return {
      command: process.execPath,
      args: [entry],
      source: `${root} @ ${sha ?? "?"}${dirty ? " (dirty)" : ""}`,
    };
  }
  // Pinned once per run, so every trial runs the version the run records.
  const version = execFileSync("npm", ["view", MCP_PACKAGE, "version"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  const spec = `${MCP_PACKAGE}@${version}`;
  return { command: "npx", args: ["-y", spec], source: `npm ${spec}` };
}

function pluginDir(skillsSource: string | null): string {
  if (
    !skillsSource ||
    !existsSync(path.join(skillsSource, ".claude-plugin", "plugin.json"))
  ) {
    throw new Error(
      "The plugin profile loads the Claude Code plugin from a growthbook/skills checkout. Point SKILLS_SRC or agent-skills.local.json at one.",
    );
  }
  return skillsSource;
}

// What the session started with: the evidence that a trial saw only its
// profile's tools.
const initEvent = z.object({
  model: z.string(),
  permissionMode: z.string(),
  apiKeySource: z.string(),
  tools: z.array(z.string()),
  mcp_servers: z.array(z.object({ name: z.string(), status: z.string() })),
  plugins: z.array(z.object({ name: z.string(), path: z.string() })),
  skills: z.array(z.string()),
  agents: z.array(z.string()),
});
type InitEvent = z.infer<typeof initEvent>;

const modelUsage = z.object({
  inputTokens: z.number(),
  outputTokens: z.number(),
  cacheReadInputTokens: z.number(),
  cacheCreationInputTokens: z.number(),
  costUSD: z.number(),
});

const resultEvent = z.object({
  subtype: z.string(),
  is_error: z.boolean(),
  result: z.string().optional(),
  errors: z.array(z.string()).optional(),
  // A resumed session's totals include earlier turns; this is one turn's.
  model_usage_since_last_result: z.record(z.string(), modelUsage).optional(),
});
type ResultEvent = z.infer<typeof resultEvent>;

const messageEvent = z.object({
  message: z.object({
    content: z.union([
      z.string(),
      z.array(z.looseObject({ type: z.string() })),
    ]),
  }),
});

const textBlock = z.object({ text: z.string() });
const toolUseBlock = z.object({
  id: z.string(),
  name: z.string(),
  input: z.unknown(),
});
const toolResultBlock = z.object({
  tool_use_id: z.string(),
  content: z
    .union([
      z.string(),
      z.array(z.object({ type: z.string(), text: z.string().optional() })),
    ])
    .optional(),
  is_error: z.boolean().nullish(),
});

// Tool results are text; most GrowthBook ones are JSON.
function toolResultValue(
  content: z.infer<typeof toolResultBlock>["content"],
): unknown {
  const text =
    typeof content === "string"
      ? content
      : (content ?? []).flatMap((c) => (c.text ? [c.text] : [])).join("\n");
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

interface ParsedStream {
  session: string | null;
  init: InitEvent | null;
  result: ResultEvent | null;
  events: TranscriptEvent[];
}

const eventHead = z.object({
  type: z.string(),
  subtype: z.string().nullish(),
  session_id: z.string().optional(),
});

// Claude Code's stream-json lines, as transcript events. User-role messages
// carry only tool results here; injected text (a loaded skill's body) is the
// harness talking to the model, not the person.
function parseStream(lines: unknown[]): ParsedStream {
  const parsed: ParsedStream = {
    session: null,
    init: null,
    result: null,
    events: [],
  };
  const toolNames = new Map<string, string>();
  for (const line of lines) {
    const head = eventHead.safeParse(line);
    if (!head.success) continue;
    const { type, subtype, session_id } = head.data;
    parsed.session = session_id ?? parsed.session;
    if (type === "system" && subtype === "init") {
      parsed.init ??= initEvent.parse(line);
    } else if (type === "result") {
      parsed.result = resultEvent.parse(line);
    } else if (type === "assistant" || type === "user") {
      const { content } = messageEvent.parse(line).message;
      if (typeof content === "string") continue;
      for (const block of content) {
        if (type === "assistant" && block.type === "text") {
          const { text } = textBlock.parse(block);
          if (text.trim()) parsed.events.push({ kind: "assistant", text });
        } else if (type === "assistant" && block.type === "tool_use") {
          const { id, name, input } = toolUseBlock.parse(block);
          toolNames.set(id, name);
          parsed.events.push({ kind: "tool-call", id, name, args: input });
        } else if (type === "user" && block.type === "tool_result") {
          const result = toolResultBlock.parse(block);
          parsed.events.push({
            kind: "tool-result",
            id: result.tool_use_id,
            name: toolNames.get(result.tool_use_id) ?? "unknown",
            result: toolResultValue(result.content),
            isError: !!result.is_error,
          });
        }
      }
    }
  }
  return parsed;
}

function usageOf(result: ResultEvent | null): Usage {
  const perModel = Object.values(result?.model_usage_since_last_result ?? {});
  if (!perModel.length) return callUsage(undefined, undefined, undefined);
  return perModel.reduce(
    (sum, m) =>
      addUsage(
        sum,
        callUsage(
          m.inputTokens + m.cacheReadInputTokens + m.cacheCreationInputTokens,
          m.outputTokens,
          m.costUSD,
        ),
      ),
    emptyUsage(),
  );
}

// Which argument names the skill, for the plugin's Skill tool and the MCP
// server's skill reader.
const SKILL_ARG = new Map([
  ["Skill", "skill"],
  [READ_SKILL_TOOL, "name"],
]);

// Skills the agent loaded, counting only loads that succeeded.
function skillsLoaded(events: TranscriptEvent[]): string[] {
  const failed = new Set(
    events.flatMap((e) =>
      e.kind === "tool-result" && e.isError ? [e.id] : [],
    ),
  );
  return events.flatMap((e) => {
    const arg = e.kind === "tool-call" ? SKILL_ARG.get(e.name) : undefined;
    if (e.kind !== "tool-call" || !arg || failed.has(e.id)) return [];
    const args = z.record(z.string(), z.unknown()).safeParse(e.args);
    const skill = args.success ? args.data[arg] : null;
    return typeof skill === "string" ? [skill] : [];
  });
}

interface ClaudeRun {
  lines: unknown[];
  exitCode: number | null;
  stderr: string;
  timedOut: boolean;
}

function runClaude(
  args: string[],
  prompt: string,
  cwd: string,
  env: Record<string, string>,
): Promise<ClaudeRun> {
  return new Promise((resolve, reject) => {
    const child = spawn("claude", args, { cwd, env });
    const lines: unknown[] = [];
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, TURN_TIMEOUT_MS);
    createInterface({ input: child.stdout }).on("line", (line) => {
      try {
        lines.push(JSON.parse(line));
      } catch {
        // Not an event; keep it with stderr for the error message.
        stderr = `${stderr}${line}\n`.slice(-4000);
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString()}`.slice(-4000);
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (exitCode) => {
      clearTimeout(timer);
      resolve({ lines, exitCode, stderr, timedOut });
    });
    child.stdin.end(prompt);
  });
}

function endOf(run: ClaudeRun, result: ResultEvent | null): HarnessTurn["end"] {
  if (run.timedOut) {
    return {
      kind: "error",
      message: `Claude Code ran past ${TURN_TIMEOUT_MS / 60000} minutes`,
    };
  }
  if (result && !result.is_error && run.exitCode === 0) {
    return { kind: "reply", text: result.result ?? "" };
  }
  const why = result
    ? [result.subtype, ...(result.errors ?? []), result.result ?? ""]
        .filter(Boolean)
        .join(": ")
    : run.stderr.trim().split("\n").slice(-5).join("\n");
  return {
    kind: "error",
    message: `Claude Code exited ${run.exitCode}: ${why || "no output"}`,
  };
}

interface Launch {
  cwd: string;
  args: string[];
  env: Record<string, string>;
}

// Claude Code headless: one `claude -p` per user message, resumed by session
// id, signed in with the developer's own Claude login. Each trial runs in its
// own directory with only the eval server, the trial's key, and the profile's
// tools.
//
// Not --bare: it swaps Claude Code's system prompt for a few dozen tokens,
// drops the Skill tool, and ignores the CLI login. --restricted keeps out the
// developer's settings, hooks, CLAUDE.md, and plugins instead, and
// --strict-mcp-config their MCP servers.
export function claudeCodeHarness(
  profile: ExternalProfile,
  { model, skillsSource, mcpServer }: ClaudeCodeOptions,
): Harness {
  const version = assertClaudeLogin();
  const mcp =
    profile === "mcp" || profile === "mcp-api"
      ? mcpServerLaunch(mcpServer)
      : null;
  const plugin = profile === "plugin" ? pluginDir(skillsSource) : null;
  const models = new Set<string>();
  let firstInit: InitEvent | null = null;

  // A trial whose tools didn't load would grade an agent without them, and
  // one that found an API key would bill it instead of the CLI login.
  const observe = (init: InitEvent) => {
    firstInit ??= init;
    models.add(init.model);
    if (init.apiKeySource !== "none") {
      throw new Error(
        `Claude Code signed in with ${init.apiKeySource}, not your Claude login`,
      );
    }
    const server = init.mcp_servers.find((s) => s.name === MCP_NAME);
    if (mcp && server?.status !== "connected") {
      throw new Error(
        `The GrowthBook MCP server didn't start: ${server?.status ?? "not listed"}`,
      );
    }
    if (plugin && !init.plugins.some((p) => p.name === PLUGIN_NAME)) {
      throw new Error("Claude Code didn't load the GrowthBook plugin");
    }
  };

  const prepare = async ({
    apiUrl,
    apiKey,
    workdir,
  }: HarnessEnv): Promise<Launch> => {
    const args = [
      "-p",
      "--output-format",
      "stream-json",
      "--verbose",
      ...FENCE_FLAGS,
      "--permission-mode",
      "dontAsk",
      "--max-budget-usd",
      String(TURN_BUDGET_USD),
      ...(model ? ["--model", model] : []),
    ];
    let gbEnv: Record<string, string> = {};

    if (mcp) {
      const config = path.join(workdir, ".mcp-config.json");
      await writeFile(
        config,
        JSON.stringify({
          mcpServers: {
            [MCP_NAME]: {
              type: "stdio",
              command: mcp.command,
              args: mcp.args,
              env: {
                GB_API_KEY: apiKey,
                GB_API_URL: apiUrl,
                ...(profile === "mcp-api"
                  ? { GB_SKILLS_ENABLED: "false" }
                  : {}),
              },
            },
          },
        }),
      );
      args.push(
        "--mcp-config",
        config,
        "--tools",
        "",
        "--allowedTools",
        `mcp__${MCP_NAME}`,
      );
    } else if (plugin) {
      gbEnv = { GB_API_KEY: apiKey, GB_API_URL: apiUrl };
      args.push(
        "--plugin-dir",
        plugin,
        // Skills send the agent to their reference files, which --restricted
        // would otherwise keep out of reach. Only the skills, not the repo.
        "--add-dir",
        path.join(plugin, "skills"),
        "--tools",
        "Skill,Bash,Read",
        "--allowedTools",
        "Skill",
        "Read",
        `Bash(${path.join(plugin, "scripts", "gb-call")} *)`,
        "Bash(sleep *)",
      );
    } else {
      args.push(
        "--tools",
        "Bash,Read,Grep,Glob",
        "--allowedTools",
        "Bash(curl *)",
        "Read",
        "Grep",
        "Glob",
        // The key itself, not an env var: a command that expands a variable
        // never matches Bash(curl *), so every authenticated call would be
        // denied. It's the trial's throwaway key, valid only on this server.
        // The shell limit is the harness's fence, not GrowthBook's, so the
        // agent hears about it the way a customer's restricted agent would.
        "--append-system-prompt",
        `GrowthBook's REST API is at ${apiUrl}. Authenticate with the API key ${apiKey} as a Bearer token. The OpenAPI spec is at ${apiUrl}/api/v1/openapi.yaml. The shell runs only curl; to search a large response, save it with curl -o and use the Grep and Read tools.`,
      );
    }

    return {
      cwd: workdir,
      args,
      // Only what the CLI needs, so nothing else from the developer's shell
      // (their GrowthBook key, an API key, provider overrides) reaches a trial.
      env: claudeEnv({
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
        // npx's first fetch of the MCP package can outlast the default wait.
        MCP_TIMEOUT: "60000",
        ...gbEnv,
      }),
    };
  };

  const adapter = (): HarnessAdapter => {
    let launch: Launch | null = null;
    return {
      prepare: async (env) => {
        launch = await prepare(env);
      },
      send: async (message, session) => {
        if (!launch) throw new Error("send() before prepare()");
        const run = await runClaude(
          [...launch.args, ...(session ? ["--resume", session] : [])],
          message,
          launch.cwd,
          launch.env,
        );
        const stream = parseStream(run.lines);
        if (stream.init) observe(stream.init);
        return {
          session: stream.session,
          events: stream.events,
          usage: usageOf(stream.result),
          skillsLoaded: skillsLoaded(stream.events),
          end: endOf(run, stream.result),
        };
      },
      // The CLI saves each session under ~/.claude; eval sessions don't stay.
      // Never throws: a trial whose CLI crashed before saving a session has
      // nothing to purge, and the CLI exits 1 for that, which would otherwise
      // abort the run before its summary is written.
      cleanup: async () => {
        if (!launch) return;
        const purge = spawnSync("claude", ["purge", launch.cwd, "--yes"], {
          env: claudeEnv(),
          encoding: "utf8",
        });
        if (purge.status !== 0) {
          const why = `${purge.stdout ?? ""}${purge.stderr ?? ""}`.trim();
          process.stderr.write(
            `claude purge ${launch.cwd} exited ${purge.status}: ${why.split("\n").pop() ?? ""}\n`,
          );
        }
      },
    };
  };

  return {
    name: "claude-code",
    profile,
    metadata: () => ({
      claudeCode: version,
      profile,
      agentModel: [...models].join(", ") || (model ?? "Claude Code default"),
      ...(mcp ? { mcpServer: mcp.source } : {}),
      ...(plugin ? { plugin } : {}),
      ...(firstInit ? { init: JSON.stringify(firstInit) } : {}),
    }),
    adapter,
  };
}
