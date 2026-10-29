import { randomUUID } from "crypto";
import type { AIModel } from "shared/ai";
import {
  getMessageText,
  tryParseToolResultJson,
  type AIChatMessage,
} from "shared/ai-chat";
import type { AIAgentPendingAction } from "shared/validators";
import {
  runAgentTurnToCompletion,
  type HeadlessTurnInput,
} from "back-end/src/enterprise/services/agent-handler";
import { generalAgentConfig } from "back-end/src/agent/general-agent";
import { listDomainSkills } from "back-end/src/agent/skills";
import { normalizePath } from "back-end/src/agent/dispatcher";
import type {
  ApiCall,
  TranscriptEvent,
} from "back-end/test/evals/harness/record";
import { assertProviderKeys } from "back-end/test/evals/harness/env";
import { takeAgentUsage } from "back-end/test/evals/harness/usage";
import type { World } from "back-end/test/evals/harness/world";
import type { AgentTurn, Driver, DriverFactory } from "./driver";

export const IN_APP_PROFILES = ["skills", "no-skills"] as const;
export type InAppProfile = (typeof IN_APP_PROFILES)[number];

// The in-app assistant, run in process the way Slack runs it: one headless
// turn per user message or confirm-card click, against the trial's org.
export function inAppDriver(
  profile: InAppProfile,
  agentModel: AIModel,
): DriverFactory {
  assertProviderKeys([agentModel]);
  return {
    name: "in-app",
    profile,
    metadata: () => ({
      agentModel,
      skills: listDomainSkills({ settings: {} } as World["org"])
        .map((s) => s.name)
        .join(", "),
    }),
    create: async (world) => {
      if (profile === "no-skills") {
        await world.updateOrgSettings({
          disabledAgentSkills: listDomainSkills(world.org).map((s) => s.name),
        });
      }
      return inAppConversation(world);
    },
  };
}

function inAppConversation(world: World): Driver {
  const conversationId = `conv_${randomUUID()}`;
  const transcript: TranscriptEvent[] = [];
  const seen = new Set<string>();
  let pending: AIAgentPendingAction | null = null;

  const turn = async (
    input: Omit<HeadlessTurnInput, "conversationId">,
  ): Promise<AgentTurn> => {
    const result = await runAgentTurnToCompletion({
      context: world.context,
      config: generalAgentConfig,
      input: { ...input, conversationId },
    });
    const doc =
      await world.context.models.aiConversations.getById(conversationId);
    const fresh = ((doc?.messages ?? []) as AIChatMessage[]).filter(
      (m) => !seen.has(m.id),
    );
    fresh.forEach((m) => seen.add(m.id));
    transcript.push(...fresh.flatMap(toEvents));

    if (!result.ok) {
      transcript.push({ kind: "error", message: result.message });
      return { kind: "error", message: result.message };
    }
    pending = result.pendingAction;
    if (pending) {
      transcript.push({
        kind: "confirm",
        summary: pending.summary,
        method: pending.method,
        path: pending.path,
        ...(pending.body !== undefined ? { body: pending.body } : {}),
      });
      return { kind: "confirm", summary: pending.summary };
    }
    const ask = askedThisTurn(fresh);
    if (ask) {
      transcript.push({ kind: "ask", ...ask });
      return { kind: "ask", ...ask };
    }
    return { kind: "reply", text: result.reply };
  };

  return {
    start: (opening) => turn({ message: opening }),
    reply: (message) => turn({ message }),
    decide: async (decision) => {
      if (!pending) {
        throw new Error("decide() called with no confirm card showing");
      }
      transcript.push({ kind: "decision", decision });
      return turn({
        message: "",
        confirmActionId: pending.id,
        confirmDecision: decision,
      });
    },
    finish: async () => ({
      transcript,
      calls: callsFrom(transcript),
      usage: takeAgentUsage(world.org.id),
      skillsLoaded: transcript.flatMap((e) =>
        e.kind === "tool-call" && e.name === "loadSkill"
          ? [String((e.args as { name?: unknown }).name)]
          : [],
      ),
    }),
  };
}

function toEvents(message: AIChatMessage): TranscriptEvent[] {
  switch (message.role) {
    case "user": {
      const text = getMessageText(message);
      return text ? [{ kind: "user", text }] : [];
    }
    case "assistant": {
      if (message.isError) {
        return [{ kind: "error", message: getMessageText(message) }];
      }
      if (typeof message.content === "string") {
        return message.content.trim()
          ? [{ kind: "assistant", text: message.content }]
          : [];
      }
      return message.content.flatMap((part): TranscriptEvent[] => {
        if (part.type === "text" && part.text.trim()) {
          return [{ kind: "assistant", text: part.text }];
        }
        if (part.type === "tool-call") {
          return [
            {
              kind: "tool-call",
              id: part.toolCallId,
              name: part.toolName,
              args: part.args,
            },
          ];
        }
        return [];
      });
    }
    case "tool":
      return message.content.map((part) => ({
        kind: "tool-result",
        id: part.toolCallId,
        name: part.toolName,
        result: tryParseToolResultJson(part.result) ?? part.result,
        isError: !!part.isError,
      }));
    default:
      return [];
  }
}

function askedThisTurn(
  messages: AIChatMessage[],
): { question: string; options: string[] } | null {
  for (const message of [...messages].reverse()) {
    if (message.role !== "assistant" || typeof message.content === "string") {
      continue;
    }
    for (const part of message.content) {
      if (part.type === "tool-call" && part.toolName === "askUser") {
        const { question, options } = part.args as {
          question?: string;
          options?: { label?: string }[];
        };
        return {
          question: question ?? "",
          options: (options ?? []).map((o) => o.label ?? ""),
        };
      }
    }
  }
  return null;
}

// Every callApi call that reached a REST handler, paired with its status.
// Parked writes appear once confirmed, when the replay records its own pair.
function callsFrom(transcript: TranscriptEvent[]): ApiCall[] {
  const statuses = new Map<string, number>();
  for (const e of transcript) {
    if (e.kind === "tool-result" && e.name === "callApi") {
      const status = (e.result as { status?: unknown } | null)?.status;
      if (typeof status === "number") statuses.set(e.id, status);
    }
  }
  return transcript.flatMap((e): ApiCall[] => {
    if (e.kind !== "tool-call" || e.name !== "callApi") return [];
    const status = statuses.get(e.id);
    if (status === undefined) return [];
    const args = e.args as {
      method?: string;
      path?: string;
      query?: Record<string, unknown>;
      body?: unknown;
    };
    return [
      {
        method: args.method ?? "GET",
        path: normalizePath(args.path ?? ""),
        ...(args.query
          ? {
              query: Object.fromEntries(
                Object.entries(args.query).map(([k, v]) => [k, String(v)]),
              ),
            }
          : {}),
        ...(args.body !== undefined ? { body: parseBody(args.body) } : {}),
        status,
      },
    ];
  });
}

function parseBody(body: unknown): unknown {
  if (typeof body !== "string") return body;
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}
