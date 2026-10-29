import type {
  TranscriptEvent,
  Usage,
} from "back-end/test/evals/harness/record";

// How the agent learns GrowthBook: the MCP server with its bundled skills, the
// same server with skills off, the Agent Skills plugin, or only a base URL,
// a key, and the public OpenAPI spec.
export const EXTERNAL_PROFILES = ["mcp", "mcp-api", "plugin", "bare"] as const;
export type ExternalProfile = (typeof EXTERNAL_PROFILES)[number];

// Everything one trial's agent may reach: the eval server, a key for the
// trial's throwaway org, and a fresh directory to work in.
export interface HarnessEnv {
  apiUrl: string;
  apiKey: string;
  workdir: string;
}

// The agent's work on one user message.
export interface HarnessTurn {
  // Null when the harness failed before it opened a session.
  session: string | null;
  events: TranscriptEvent[];
  usage: Usage;
  skillsLoaded: string[];
  // The agent's last message, or why the turn failed.
  end: { kind: "reply"; text: string } | { kind: "error"; message: string };
}

// One trial's conversation with an agent harness (Claude Code, Codex, …):
// `prepare` once, then `send` per user message, resuming the session.
export interface HarnessAdapter {
  prepare(env: HarnessEnv): Promise<void>;
  send(message: string, session: string | null): Promise<HarnessTurn>;
}

// A harness, set up once per run for one profile, so a missing CLI or plugin
// fails the run before any trial. Each trial gets its own adapter, because an
// adapter holds that trial's environment.
export interface Harness {
  name: string;
  profile: ExternalProfile;
  // Recorded with the run: harness version, model, where its tools came from.
  metadata(): Record<string, string>;
  adapter(): HarnessAdapter;
}
