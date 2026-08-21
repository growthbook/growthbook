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
import { getSkillByName, getSkillNames } from "back-end/src/agent/skills";
import type { ReqContext } from "back-end/types/request";

/**
 * The tools any GrowthBook agent needs to act on the app rather than just talk
 * about it: `loadSkill` to read a workflow, `callApi` to run it against the
 * REST API behind a mutation-confirmation gate, and `askUser` to stop and ask.
 *
 * Extracted from the general agent so a second agent can offer the same
 * behaviour without a second copy of the gate. The gate in particular must not
 * be duplicated — an agent that parks writes slightly differently is an agent
 * that can write without the user seeing it.
 */

// =============================================================================
// Path matchers & helpers
// =============================================================================

const EXPLORATION_PATH_RE =
  /^\/api\/v[12]\/product-analytics\/(metric|fact-table|data-source|funnel)-exploration\/?$/;

/** Read-only POST that looks up distinct column values for a fact table. The
 * product-analytics skill mandates calling this during normal chart building,
 * so it must be exempt from the mutation-confirmation gate. */
const COLUMN_VALUES_PATH_RE =
  /^\/api\/v[12]\/product-analytics\/column-values\/?$/;

function isExplorationPath(path: string): boolean {
  // Normalize first so we match the canonical `/api/v1/...` form the
  // dispatcher routes to, regardless of the prefix shape the LLM sent
  // (`/api/v1/...`, `/v1/...`, or `/...`). Also strips any query string.
  return EXPLORATION_PATH_RE.test(normalizePath(path));
}

/**
 * Deterministic mutation gate. Any non-GET call mutates configuration and is
 * parked for explicit user confirmation, except a small allowlist of
 * read-only POSTs (experiment snapshot refreshes, product-analytics
 * explorations, and column-value lookups) that compute or read data without
 * changing configuration.
 *
 * The path is normalized first (via the dispatcher's `normalizePath`) so the
 * allowlist matches regardless of whether the LLM sends `/api/v1/...`,
 * `/v1/...`, or `/...` — the same forms the dispatcher accepts when routing.
 */
function requiresMutationConfirmation(input: DispatchInput): boolean {
  if (input.method === "GET") return false;
  const path = normalizePath(input.path);
  if (/^\/api\/v[12]\/experiments\/[^/]+\/snapshot\/?$/.test(path)) {
    return false;
  }
  if (isExplorationPath(path)) {
    return false;
  }
  if (COLUMN_VALUES_PATH_RE.test(path)) {
    return false;
  }
  return true;
}

/**
 * Models occasionally serialize `body` as a JSON-encoded string ("the JSON")
 * instead of an object even when told not to. Detect that and parse it back
 * to an object so the underlying handler's schema validates cleanly.
 *
 * This is intentionally permissive — only triggers when the string starts
 * with `{` or `[` after trim. Anything else is passed through unchanged.
 */
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

/**
 * Trim the response body the agent sees for two reasons: keep token usage
 * sane on big list endpoints, and keep the agent focused on actionable parts
 * (status, message, the relevant top-level fields).
 *
 * For successful exploration responses we elide `exploration.result.rows`
 * (which the chart UI uses but the agent doesn't read row-by-row) and
 * surface only summary fields.
 */
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
      "Name of the skill to load (must match one of the names in the 'Available skills' list in the system prompt).",
    ),
});

const LOAD_SKILL_DESCRIPTION =
  "Load the full instructions for a named skill. Call this when you've " +
  "decided which skill applies to the user's request — its return value " +
  "contains the detailed REST API workflow (endpoints, request bodies, " +
  "examples) for that capability area. Returns { status, name, description, " +
  "body } on a hit, or { status: 'not_found', availableSkills } if the " +
  "name doesn't match — in which case retry with a valid name.";

/**
 * The `loadSkill` hit result, built in one place so a call the model makes and
 * one seeded from a slash command are byte-identical — the model reads both in
 * the same transcript, and the shape is what `LOAD_SKILL_DESCRIPTION` promises.
 */
export function loadSkillResult(name: string): SkillLoadResult | undefined {
  const skill = getSkillByName(name);
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

export interface AgentApiToolOptions {
  /**
   * Which skills this agent may load. Defaults to the whole registry; pass a
   * narrower resolver to keep an agent scoped to its own domain, so it never
   * learns endpoints outside it.
   */
  resolveSkill?: (name: string) => SkillLoadResult | undefined;
  /** Skill names offered in the `loadSkill` error message. Defaults to all. */
  availableSkillNames?: () => string[];
}

/**
 * Build `loadSkill`, `callApi`, and `askUser` for one request.
 *
 * `callApi` never executes a mutating call directly: it parks it on the
 * conversation as a `pendingAction`, emits `confirm-action`, and returns the
 * awaiting-confirmation sentinel. The shared agent handler replays the exact
 * stored call once the user confirms, so the model is never trusted to reissue
 * it.
 */
export function buildAgentApiTools(
  ctx: ReqContext,
  buffer: ConversationBuffer,
  emit?: AgentEmit,
  options: AgentApiToolOptions = {},
) {
  const resolve = options.resolveSkill ?? loadSkillResult;
  const listSkills = options.availableSkillNames ?? getSkillNames;

  return {
    loadSkill: aiTool({
      description: LOAD_SKILL_DESCRIPTION,
      inputSchema: loadSkillInputSchema,
      execute: async (input) => {
        const result = resolve(input.name);
        if (!result) {
          return {
            status: "not_found" as const,
            message: `No skill named "${input.name}". Pick one from availableSkills and retry.`,
            availableSkills: listSkills(),
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

        // Deterministic mutation gate: never execute a mutating call here.
        // Park it on the conversation, surface a confirmation prompt, and
        // return the awaiting-confirmation sentinel. The StreamProcessor
        // drops this tool-call from the transcript and the handler ends the
        // turn; the user's decision is replayed as a real call/result pair
        // next turn, so the model never sees the gate.
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
        // Surface the question to the chat UI. The frontend renders the
        // options as buttons; clicking one triggers a regular user message
        // (the option's label) on the next turn.
        if (emit) {
          emit("ask-user", {
            question: input.question,
            options: input.options,
            allowMultiple: input.allowMultiple ?? false,
          });
        }
        // The tool result is mostly a marker for the agent that the
        // question was delivered. We deliberately don't include the
        // options here — the agent already knows them from the input.
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
