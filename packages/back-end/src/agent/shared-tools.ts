import { randomUUID } from "crypto";
import { z } from "zod";
import type { AIAgentPendingAction } from "shared/validators";
import { aiTool } from "back-end/src/enterprise/services/ai";
import type {
  AgentEmit,
  SkillLoadResult,
} from "back-end/src/enterprise/services/agent-handler";
import type { ConversationBuffer } from "back-end/src/enterprise/services/conversation-buffer";
import { AWAITING_CONFIRMATION_RESULT } from "back-end/src/enterprise/services/stream-processor";
import {
  dispatchInternal,
  normalizePath,
  type DispatchInput,
  type DispatchResult,
} from "back-end/src/agent/dispatcher";
import { listDomainSkills, readSkill } from "back-end/src/agent/skills";
import type { ReqContext } from "back-end/types/request";

// `loadSkill`, `callApi` behind the mutation gate, and `askUser`. Shared, not
// copied per agent: one that parks writes differently can write unseen.

// =============================================================================
// Path matchers & helpers
// =============================================================================

const EXPLORATION_PATH_RE =
  /^\/api\/v[12]\/product-analytics\/(metric|fact-table|data-source|funnel)-exploration\/?$/;

function isExplorationPath(path: string): boolean {
  // Normalize first so we match the canonical `/api/v1/...` form the
  // dispatcher routes to, regardless of the prefix shape the LLM sent
  // (`/api/v1/...`, `/v1/...`, or `/...`). Also strips any query string.
  return EXPLORATION_PATH_RE.test(normalizePath(path));
}

/** Every non-GET is parked, bar an allowlist of read-only POSTs. Path normalized first. */
function requiresMutationConfirmation(input: DispatchInput): boolean {
  if (input.method === "GET") return false;
  const path = normalizePath(input.path);
  if (/^\/api\/v[12]\/experiments\/[^/]+\/snapshot\/?$/.test(path)) {
    return false;
  }
  if (isExplorationPath(path)) {
    return false;
  }
  return true;
}

/** Models sometimes JSON-encode `body` as a string; parse it back. */
function coerceBody(body: unknown): unknown {
  if (typeof body !== "string") return body;
  const trimmed = body.trim();
  if (!trimmed || (trimmed[0] !== "{" && trimmed[0] !== "[")) {
    return body;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    // Not valid JSON — let the handler reject it with a real error.
    return body;
  }
}

/** Elide `exploration.result.rows` — the chart UI gets them over SSE — and cap the rest. */
const MAX_BODY_CHARS = 16_000;

function summarizeResult(result: DispatchResult): {
  status: number;
  body: unknown;
} {
  const { status, body } = result;
  if (
    status >= 200 &&
    status < 300 &&
    body &&
    typeof body === "object" &&
    !Array.isArray(body)
  ) {
    const b = body as Record<string, unknown>;
    if (b.exploration && typeof b.exploration === "object") {
      const exp = b.exploration as Record<string, unknown>;
      const result = exp.result as { rows?: unknown[] } | undefined;
      const rowCount = Array.isArray(result?.rows) ? result.rows.length : 0;
      // Keep config but elide row data — the chart UI gets the full body
      // through the chart-result SSE event.
      return {
        status,
        body: {
          ...b,
          exploration: {
            ...exp,
            result: {
              ...(result ?? {}),
              rows: undefined,
              rowCount,
            },
          },
        },
      };
    }
  }

  // Fall-through: cap body size as a guardrail against runaway responses.
  const serialized = safeStringify(body);
  if (serialized.length > MAX_BODY_CHARS) {
    return {
      status,
      body: {
        truncated: true,
        message:
          "Response was too large to include in full. Re-call with narrower filters or pagination params.",
        preview: serialized.slice(0, MAX_BODY_CHARS),
      },
    };
  }

  return result;
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

// =============================================================================
// Tool schemas & descriptions
// =============================================================================

// --- callApi ---------------------------------------------------------------

const callApiInputSchema = z.object({
  method: z
    .enum(["GET", "POST", "PUT", "PATCH", "DELETE"])
    .describe("HTTP method for the request"),
  path: z
    .string()
    .describe(
      "Full path including version prefix, e.g. '/api/v1/features/feat_abc'",
    ),
  query: z
    .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
    .optional()
    .describe("Query string parameters as a flat object of strings"),
  body: z
    .unknown()
    .optional()
    .describe(
      "Request body for POST/PUT/PATCH. Pass it as a JSON object/array " +
        "directly — do NOT wrap it in a JSON-encoded string. Example: " +
        '`{"foo": "bar"}`, not `"{\\"foo\\":\\"bar\\"}"`.',
    ),
  summary: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .describe(
      "One-line, human-readable description of what this call changes, e.g. " +
        "\"Create dashboard 'Growth KPIs' with 6 blocks: revenue KPI, signup " +
        'trend, …". Shown to the user on the confirmation prompt for a ' +
        "mutating call, where the request body is collapsed behind a " +
        "disclosure — without it they see only the method and path. Ignored " +
        "for reads.",
    ),
});

const CALL_API_DESCRIPTION =
  "Make a request to the GrowthBook REST API. " +
  "Use `loadSkill` first to get the workflow and endpoint details for the " +
  "capability area you need. Returns { status, body }: 2xx is success, " +
  "non-2xx contains an error message in body.message.";

// --- loadSkill -------------------------------------------------------------

const loadSkillInputSchema = z.object({
  name: z
    .string()
    .min(1)
    .describe(
      "Top-level skill name from 'Available skills', or a qualified <domain>/references/<workflow> path from a loaded domain router.",
    ),
});

const LOAD_SKILL_DESCRIPTION =
  "Load a top-level skill or qualified workflow reference. Call this when " +
  "you've decided which skill applies to the user's request — its return value " +
  "contains the detailed REST API workflow (endpoints, request bodies, " +
  "examples) for that capability area. Returns { status, name, description, " +
  "body } on a hit, or { status: 'not_found', availableSkills } if the " +
  "name doesn't match — in which case retry with a valid name.";

/** Built here so a model-issued load and a slash-command-seeded one are identical. */
export function loadSkillResult(name: string): SkillLoadResult | undefined {
  const skill = readSkill(name);
  if (!skill) return undefined;
  return {
    status: "ok",
    name: skill.name,
    description: skill.description,
    body: skill.body,
  };
}

// --- askUser ---------------------------------------------------------------

const askUserOptionSchema = z.object({
  id: z
    .string()
    .min(1)
    .describe(
      "Stable identifier for the option (e.g. a datasource id). The agent will receive this back via the user's reply context.",
    ),
  label: z
    .string()
    .min(1)
    .max(200)
    .describe("Display text shown on the button — short and unambiguous."),
  description: z
    .string()
    .max(300)
    .optional()
    .describe("Optional sub-line shown under the label for extra context."),
});

const askUserInputSchema = z.object({
  question: z
    .string()
    .min(1)
    .max(500)
    .describe("Plain-language question to present to the user."),
  options: z
    .array(askUserOptionSchema)
    .min(2)
    .max(8)
    .describe(
      "Two to eight options the user can pick from. Order them by likelihood.",
    ),
  allowMultiple: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      "If true, the user can select multiple options. Default is single-select.",
    ),
});

const ASK_USER_DESCRIPTION =
  "Ask the user a multiple-choice question and stop. The chat UI renders the " +
  "options as clickable buttons; the user's pick arrives as the next chat " +
  "message. Use only when the request is ambiguous and you cannot pick a " +
  "sensible default. After calling this, end your turn.";

// =============================================================================
// Tool construction
// =============================================================================

/** Query values arrive loosely typed from the model; the dispatcher wants strings. */
function stripQueryStrings(
  query: Record<string, string | number | boolean> | undefined,
): Record<string, string> | undefined {
  if (!query) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(query)) {
    out[k] = String(v);
  }
  return out;
}

/** Build `loadSkill`, `callApi`, and `askUser` for one request. */
export function buildAgentApiTools(
  ctx: ReqContext,
  buffer: ConversationBuffer,
  emit?: AgentEmit,
) {
  return {
    loadSkill: aiTool({
      description: LOAD_SKILL_DESCRIPTION,
      inputSchema: loadSkillInputSchema,
      execute: async (input) => {
        const result = loadSkillResult(input.name);
        if (!result) {
          return {
            status: "not_found" as const,
            message: `No skill named "${input.name}". Pick one from availableSkills and retry.`,
            availableSkills: listDomainSkills().map((s) => s.name),
          };
        }
        return result;
      },
    }),

    callApi: aiTool({
      description: CALL_API_DESCRIPTION,
      inputSchema: callApiInputSchema,
      execute: async (input) => {
        const query = stripQueryStrings(input.query);
        const dispatchInput: DispatchInput = {
          method: input.method,
          path: input.path,
          query,
          body: coerceBody(input.body),
        };

        // Park the call and end the turn; the handler replays the stored call
        // verbatim once the user decides, so the model never sees the gate.
        if (requiresMutationConfirmation(dispatchInput)) {
          const pendingAction: AIAgentPendingAction = {
            id: randomUUID(),
            method: dispatchInput.method,
            path: dispatchInput.path,
            ...(query ? { query } : {}),
            ...(dispatchInput.body !== undefined
              ? { body: dispatchInput.body }
              : {}),
            // The model's own summary when it supplied one — the confirmation
            // card hides a summary equal to `method path`, so without this a
            // multi-block write shows nothing but the endpoint.
            summary:
              input.summary?.trim() ||
              `${dispatchInput.method} ${dispatchInput.path.split("?")[0]}`,
            createdAt: Date.now(),
          };
          buffer.setPendingAction(pendingAction);
          if (emit) {
            emit("confirm-action", {
              actionId: pendingAction.id,
              method: pendingAction.method,
              path: pendingAction.path,
              summary: pendingAction.summary,
              ...(pendingAction.query ? { query: pendingAction.query } : {}),
              ...(pendingAction.body !== undefined
                ? { body: pendingAction.body }
                : {}),
            });
          }
          return AWAITING_CONFIRMATION_RESULT;
        }

        const result = await dispatchInternal(ctx, dispatchInput, {
          onSuccess: (i, res) => {
            if (
              emit &&
              res.status >= 200 &&
              res.status < 300 &&
              isExplorationPath(i.path) &&
              res.body &&
              typeof res.body === "object" &&
              "exploration" in (res.body as Record<string, unknown>) &&
              (res.body as { exploration: unknown }).exploration
            ) {
              emit("chart-result", res.body);
            }
          },
        });
        return summarizeResult(result);
      },
    }),

    askUser: aiTool({
      description: ASK_USER_DESCRIPTION,
      inputSchema: askUserInputSchema,
      execute: async (input) => {
        // The UI renders the options as buttons; a click sends the label as
        // the next user message.
        if (emit) {
          emit("ask-user", {
            question: input.question,
            options: input.options,
            allowMultiple: input.allowMultiple ?? false,
          });
        }
        return {
          status: "asked",
          message:
            "Question shown to the user. Stop now — wait for their reply on the next turn.",
        };
      },
    }),
  };
}

// Test-only handles.
export const _coerceBody = coerceBody;
export const _requiresMutationConfirmation = requiresMutationConfirmation;
