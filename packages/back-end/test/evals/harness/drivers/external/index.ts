import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import type {
  AgentTurn,
  Driver,
  DriverFactory,
} from "back-end/test/evals/harness/drivers/driver";
import {
  addUsage,
  emptyUsage,
  type ApiCall,
  type TranscriptEvent,
} from "back-end/test/evals/harness/record";
import type { Harness, HarnessAdapter } from "./adapter";
import type { EvalServer } from "./eval-server";

// Loaded on first use, so in-app runs never load the Express app.
const startEvalServer = async () =>
  (await import("./eval-server")).startEvalServer();

// A customer's own agent harness, run as a subprocess against the eval
// server: the real app with real API-key auth.
export function externalDriver(harness: Harness): DriverFactory {
  let server: Promise<EvalServer> | null = null;
  const workdirs: string[] = [];
  return {
    name: harness.name,
    profile: harness.profile,
    metadata: harness.metadata,
    create: async (world) => {
      // Booted by the first trial; later ones share it.
      server ??= startEvalServer();
      const { url, callsFor } = await server;
      const apiKey = await world.createApiKey();
      const workdir = await mkdtemp(path.join(tmpdir(), "gb-eval-"));
      workdirs.push(workdir);
      const adapter = harness.adapter();
      await adapter.prepare({ apiUrl: url, apiKey, workdir });
      return externalConversation(adapter, () => callsFor(apiKey));
    },
    close: async () => {
      // A server that failed to boot has already failed every trial.
      await server?.then(
        (s) => s.close(),
        () => undefined,
      );
      await Promise.all(
        workdirs.map((dir) => rm(dir, { recursive: true, force: true })),
      );
    },
  };
}

// External agents pause only to talk, so there's no decide().
function externalConversation(
  adapter: HarnessAdapter,
  calls: () => ApiCall[],
): Driver {
  const transcript: TranscriptEvent[] = [];
  const skillsLoaded: string[] = [];
  let usage = emptyUsage();
  let session: string | null = null;

  const send = async (message: string): Promise<AgentTurn> => {
    transcript.push({ kind: "user", text: message });
    const turn = await adapter.send(message, session);
    session = turn.session ?? session;
    transcript.push(...turn.events);
    usage = addUsage(usage, turn.usage);
    skillsLoaded.push(...turn.skillsLoaded);
    if (turn.end.kind === "error") {
      transcript.push({ kind: "error", message: turn.end.message });
    }
    return turn.end;
  };

  return {
    start: send,
    reply: send,
    finish: async () => ({ transcript, calls: calls(), usage, skillsLoaded }),
  };
}
