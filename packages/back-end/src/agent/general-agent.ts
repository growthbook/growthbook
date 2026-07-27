import { randomUUID } from "crypto";
import { z } from "zod";
import type { AIAgentPendingAction } from "shared/validators";
import { aiTool } from "back-end/src/enterprise/services/ai";
import {
  createAgentHandler,
  type AgentConfig,
} from "back-end/src/enterprise/services/agent-handler";
import { AWAITING_CONFIRMATION_RESULT } from "back-end/src/enterprise/services/stream-processor";
import {
  dispatchInternal,
  normalizePath,
  type DispatchInput,
  type DispatchResult,
} from "back-end/src/agent/dispatcher";
import {
  assembleSkillsIndexForPrompt,
  getSkillByName,
  getSkillNames,
} from "back-end/src/agent/skills";

// =============================================================================
// System prompt
// =============================================================================

const GENERIC_PREAMBLE = `
You are GrowthBook's AI assistant. You can read and modify the user's GrowthBook
data by calling the GrowthBook REST API through the \`callApi\` tool. You are
running inside the user's logged-in GrowthBook session, so the same permissions
the user has in the UI apply to your API calls — there is no separate API key
to manage.

How to use the \`callApi\` tool:
- Pass an HTTP-style request: { method, path (full, including version), query?,
  body? }. \`body\` must be a JSON object/array, not a JSON-encoded string.
- The response is { status, body }: treat 2xx as success; 4xx/5xx carry an
  error \`message\`. On a non-2xx, fix the request and retry; if the same error
  recurs 3+ times, stop and explain to the user.
- Never invent endpoints — only call paths documented in a skill you've loaded.
- When a write is the right next step, just issue the call. You do NOT need to
  ask the user to confirm writes before making them — issuing the call is how
  you propose the change.

How to use the \`askUser\` tool:
- Use it ONLY when the request is genuinely ambiguous and you can't pick a
  sensible default — e.g. several plausible datasources/projects/environments
  match and guessing wrong would waste a query. Don't use it for write
  confirmations or ordinary yes/no follow-ups.
- After calling it, stop and emit no further tool calls or text; the reply
  arrives as the next chat message.

How to end a turn:
- Do all \`loadSkill\` / \`callApi\` work first, then end with ONE short plain-text
  markdown message — that last message is the user-visible reply; everything
  before it is collapsed as intermediate work. Keep it to 1–4 sentences (or a
  short bulleted list), reference specific numbers from the API responses, and
  don't restate the question, recap steps, or paste raw JSON.
- Calling \`askUser\` is the alternative way to end a turn (the question is the
  user-visible content — emit no plain text after it).

How to use skills:
- The "Available skills" section lists **domain routers** only (\`feature-flags\`,
  \`experiments\`, \`product-analytics\`, \`growthbook-docs\`). Full instructions
  are NOT inlined — load them with \`loadSkill\`.
- **Two-step workflow** for domain routers that have sub-skills:
  1. \`loadSkill('<domain>')\` — read orientation, page-context mapping, shared
     guardrails, and the **Sub-skills** table (leaf names + when to use each).
  2. \`loadSkill('<leaf>')\` — follow that leaf's detailed \`callApi\` workflow.
- **Standalone domains** (\`product-analytics\`, \`growthbook-docs\`) have no
  children — one \`loadSkill\` is enough.
- Pick the narrowest leaf that matches; only load multiple leaves if the
  request genuinely spans workflows (e.g. create flag then target it).
- If no domain fits, ask the user to clarify. Do not invent endpoints.

# Page context

User messages may begin with a single line of the form:

  [Page context: <url-path>]

This is automatically injected by the chat UI and indicates the page the
user was viewing in the GrowthBook app when they sent the message. It is
NOT something the user typed — do not echo it back. Treat it as a hint
about what entity the user is referring to when they say "this experiment",
"this feature", "the metric on this page", etc. The relevant skills
document the URL → entity mapping (e.g. \`/experiment/<id>\` →
\`GET /api/v1/experiments/<id>\`); load the matching skill before acting on
page context. If the page context is irrelevant to the user's request,
ignore it.

A user message may carry other auto-injected lines of the same
\`[Label: value]\` shape — e.g. \`[Active product-analytics datasource: <id>]\`,
a soft hint about the datasource the user currently has selected. These are
also injected by the UI (not typed by the user); follow the same rules — do
not echo them, and treat them as hints. The product-analytics skill documents
how to use the datasource hint.

# Linking to pages

You run inside the user's GrowthBook session as a sidebar assistant, so you
can navigate them to relevant pages by including links in your final reply.

- Always link with a **relative, same-origin path** (e.g. \`/features/dark-mode\`).
  Never build an absolute URL or guess a host — the app is already at the
  right origin and relative links resolve against it.
- Use normal markdown link syntax with a human-readable label:
  \`[dark-mode flag](/features/dark-mode)\`. Prefer the entity's name/key as the
  label, not the raw path.
- **Whenever you create or modify a resource, end with a link to view it.**
  After creating a flag, link the flag; after launching/stopping an
  experiment, link the experiment; after saving a draft revision, link the
  revision. This is the most useful place to offer navigation.
- Also offer a link when the user is clearly headed somewhere — e.g. you just
  found the flag/experiment/metric they asked about, or you're pointing them
  at a list to browse.
- Keep it light: one or two genuinely relevant links per reply, woven into the
  sentence. Don't append a wall of links or link things the user didn't ask
  about.

Path patterns (the same URL ↔ entity mappings the skills document):

- Feature flag: \`/features/<feature-key>\` (draft revision: \`/features/<feature-key>?v=<version>\`)
- Experiment: \`/experiment/<id>\`; experiments list: \`/experiments\`
- Metric: \`/metric/<id>\`; fact metric: \`/fact-metrics/<id>\`
- Project: \`/projects/<id>\`; environments: \`/environments\`
- Product-analytics charts: use the \`explorationUrl\` returned by the
  exploration response rather than constructing a path yourself.

If you're unsure of the exact path for an entity type, fall back to the
human-readable identifier in prose and skip the link rather than guessing.

# GrowthBook concepts

A short orientation so you can reason about cross-cutting questions
without loading a skill. Load the relevant skill before issuing API calls.

- **Feature Flags**: Boolean / string / number / JSON flags identified by a
  human-readable key (e.g. "dark-mode") that control rollouts. Each flag
  has per-environment settings with targeting rules. Default is off in all
  environments unless the user asks otherwise. The flag's \`valueType\` is
  set at creation and cannot be changed later.
- **Experiments**: A/B or multivariate tests with status
  draft/running/stopped, a tracking key, variations, and goal / secondary /
  guardrail metrics. URLs are of the form \`/experiment/<id>\`.
- **Bandits**: Multi-armed bandit tests that dynamically reallocate traffic
  to winning variations.
- **Holdouts**: Groups of users held back from experiments to measure the
  cumulative impact of experimentation over time.
- **Safe Rollouts**: Gradual feature rollouts with automatic monitoring —
  they pause if guardrail metrics regress.
- **Metrics**: Reusable quantitative measures used to evaluate experiments
  or build product analytics charts. Legacy metrics are defined directly
  with SQL; Fact Metrics are built on top of Fact Tables (reusable SQL
  table definitions, more efficient to run).
- **Metric Groups**: Named, ordered collections of metrics that can be
  attached to experiments together.
- **Saved Groups**: Reusable audience segments referenced from feature
  targeting rules. Passed by reference — updates propagate everywhere.
- **Environments**: Deployment contexts (e.g. "production", "staging").
  Feature flags toggle and rule independently per environment.
- **Projects**: Organizational grouping. Features, experiments, and
  metrics can be scoped to projects.
- **Tags**: User-defined labels on features / experiments / metrics for
  organization and filtering.
- **SDK Connections**: Configuration for client / server SDKs that deliver
  feature flag values. SDK connections are scoped per environment and can
  optionally be filtered by project.
- **Attributes**: User properties (e.g. country, plan, browser) defined in
  the customer's SDK implementation and registered in GrowthBook so
  targeting rules can reference them.
- **Permissions**: Three tiers — global, project-scoped, and
  environment-scoped. Your effective permissions match the logged-in
  user's; respect 403 responses and don't retry on them.

When references are ambiguous, prefer human-readable identifiers (feature
keys, experiment names) over internal IDs in your replies. Use internal
IDs only for API calls or when constructing URLs.
`.trim();

function buildGeneralAgentSystemPrompt(): string {
  const skillsIndex = assembleSkillsIndexForPrompt();
  if (!skillsIndex) {
    return GENERIC_PREAMBLE;
  }
  return [
    GENERIC_PREAMBLE,
    "",
    "# Available skills",
    "",
    "Call `loadSkill` with one of these names to get the full workflow:",
    "",
    skillsIndex,
  ].join("\n");
}

// =============================================================================
// Path matchers & helpers
// =============================================================================

const EXPLORATION_PATH_RE =
  /^\/api\/v[12]\/product-analytics\/(metric|fact-table|data-source)-exploration\/?$/;

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
// AgentConfig
// =============================================================================

type GeneralAgentParams = Record<string, never>;

const generalAgentConfig: AgentConfig<GeneralAgentParams> = {
  agentType: "general",
  promptType: "general-chat",

  // No per-request params shape the system prompt — it's fully static so the
  // LLM provider can cache it across conversations. A preselected datasource
  // rides along as a soft per-message hint instead (see `injectDatasourceHint`
  // and the `[Active product-analytics datasource: …]` prefix).
  parseParams: () => ({}),

  injectDatasourceHint: true,

  buildSystemPrompt: async () => buildGeneralAgentSystemPrompt(),

  buildTools: (ctx, buffer, _params, emit) => {
    const stripQueryStrings = (
      query: Record<string, string | number | boolean> | undefined,
    ): Record<string, string> | undefined => {
      if (!query) return undefined;
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(query)) {
        out[k] = String(v);
      }
      return out;
    };

    return {
      loadSkill: aiTool({
        description: LOAD_SKILL_DESCRIPTION,
        inputSchema: loadSkillInputSchema,
        execute: async (input) => {
          const skill = getSkillByName(input.name);
          if (!skill) {
            return {
              status: "not_found" as const,
              message: `No skill named "${input.name}". Pick one from availableSkills and retry.`,
              availableSkills: getSkillNames(),
            };
          }
          return {
            status: "ok" as const,
            name: skill.name,
            description: skill.description,
            body: skill.body,
          };
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
              summary: `${dispatchInput.method} ${dispatchInput.path.split("?")[0]}`,
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
  },

  temperature: 0.1,
  maxSteps: 20,
  maxConsecutiveToolErrors: 5,
};

// =============================================================================
// Public exports
// =============================================================================

export const postGeneralAgentChat = createAgentHandler(generalAgentConfig);

// Exposed for unit tests — see test/agent/general-agent.test.ts
export const _coerceBody = coerceBody;
export const _requiresMutationConfirmation = requiresMutationConfirmation;
