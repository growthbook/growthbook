import type { Response } from "express";
import {
  getMessageText,
  type AIChatAssistantMessage,
  type AIChatUserMessage,
  type OrgSkillSummary,
} from "shared/ai-chat";
import type { AuthRequest } from "back-end/src/types/AuthRequest";
import type { ReqContext } from "back-end/types/request";
import { getContextFromReq } from "back-end/src/services/organizations";
import { postGeneralAgentChat } from "back-end/src/agent/general-agent";
import { makeListChats } from "back-end/src/routers/utils/chat-controllers";
import { listSkillSummaries } from "back-end/src/agent/skills";
import {
  secondsUntilAICanBeUsedAgainForPrompt,
  simpleCompletion,
} from "back-end/src/enterprise/services/ai";
import { runAIEnabledGates } from "back-end/src/enterprise/services/ai-access";
import { getDataSourcesByOrganization } from "back-end/src/models/DataSourceModel";
import { getAllExperiments } from "back-end/src/models/ExperimentModel";
import { getRecentFeatureIds } from "back-end/src/models/FeatureModel";
import { getRecentMetricNames } from "back-end/src/models/MetricModel";

// The chat handler itself
export const postChat = postGeneralAgentChat;

// Shared chat handlers (agent-agnostic)
export {
  cancelChat,
  deleteChat,
  getChat,
  postChatFeedback,
} from "back-end/src/routers/utils/chat-controllers";

export const listChats = makeListChats("general");

export const listSkills = async (
  req: AuthRequest,
  res: Response<{ status: 200; skills: OrgSkillSummary[] }>,
): Promise<Response> => {
  const { org } = getContextFromReq(req);
  return res.status(200).json({ status: 200, skills: listSkillSummaries(org) });
};

const AUTOCOMPLETE_INSTRUCTIONS = `You autocomplete a draft message a user is typing to GrowthBook's AI assistant.
Reply with ONLY the complete message: the draft exactly as written, character for character, continued to the end of the user's thought. No quotes, no explanation.
Keep the continuation to one short sentence (under 15 words) that completes the thought and ends with a period or question mark. Prefer requests the assistant's skills below can carry out, and use the recent conversation to guess what they want next.
The user's current page in the GrowthBook app is given as a path: /features/<key> is that feature flag, /experiment/<id> that experiment, /metric/<id> or /fact-metrics/<id> that metric. When the draft says "this experiment", "this flag" or similar, it means the entity on that page.
Ground the continuation in what this organization actually has, listed below. Refer to those data sources, feature flags, experiments and metrics by their real names. Never invent a metric, flag, experiment or table that isn't listed; if nothing listed fits, keep the continuation generic.
Reply with the draft unchanged if there is no good continuation.`;

const ORG_CONTEXT_LIMIT = 15;

type ContextKind = "datasources" | "features" | "experiments" | "metrics";
const ALL_CONTEXT: ContextKind[] = [
  "datasources",
  "features",
  "experiments",
  "metrics",
];
// Which entity lists a page makes relevant. First match wins; pages with no
// clear subject (home, settings, unknown) fall back to everything.
const PAGE_CONTEXT: ReadonlyArray<[RegExp, ContextKind[]]> = [
  [
    /^\/(features|configs|constants|saved-groups|attributes|environments|namespaces|archetypes|sdks)(\/|$)/,
    ["features"],
  ],
  [
    /^\/(experiments?|bandits?|contextual-bandits?|holdouts?|reports?|learnings|ideas?|power-calculator|presentations?|present)(\/|$)/,
    ["experiments", "metrics"],
  ],
  [
    /^\/(metrics?|fact-metrics|fact-tables|metric-groups|segments|dimensions|metric-effects|correlations)(\/|$)/,
    ["metrics", "datasources"],
  ],
  [
    /^\/(product-analytics|datasources|sql-explorer|session-replay)(\/|$)/,
    ["datasources", "metrics"],
  ],
];

/** Entity lists worth sending for the page the user is on. */
export function contextKindsForPage(path?: string): ContextKind[] {
  const p = (path ?? "").split("?")[0];
  return PAGE_CONTEXT.find(([re]) => re.test(p))?.[1] ?? ALL_CONTEXT;
}

/**
 * Names of the org's entities that matter on the current page, so suggestions
 * point at real things without spending tokens on lists the page makes
 * irrelevant. Metrics are scoped to the active PA datasource when known.
 */
// ponytail: up to five queries per call; cache per org for a minute if this shows up in latency.
async function orgContextForAutocomplete(
  context: ReqContext,
  {
    datasourceId,
    currentPage,
  }: { datasourceId?: string; currentPage?: string },
): Promise<string> {
  const kinds = new Set(contextKindsForPage(currentPage));
  const want = <T>(kind: ContextKind, fetch: () => Promise<T[]>) =>
    kinds.has(kind) ? fetch() : Promise.resolve(null);

  const [datasources, features, experiments, factMetrics, legacyMetrics] =
    await Promise.all([
      want("datasources", () => getDataSourcesByOrganization(context)),
      want("features", () => getRecentFeatureIds(context, ORG_CONTEXT_LIMIT)),
      want("experiments", () =>
        getAllExperiments(context, {
          limit: ORG_CONTEXT_LIMIT,
          sortBy: { dateUpdated: -1 },
        }),
      ),
      want("metrics", () =>
        context.models.factMetrics.getRecentForPrompt({
          limit: ORG_CONTEXT_LIMIT,
          datasourceId,
        }),
      ),
      want("metrics", () =>
        getRecentMetricNames(context, {
          limit: ORG_CONTEXT_LIMIT,
          datasourceId,
        }),
      ),
    ]);
  const line = (label: string, names: string[] | null) =>
    names === null
      ? null
      : `${label}: ${names.length ? names.slice(0, ORG_CONTEXT_LIMIT).join(", ") : "(none)"}`;
  return [
    line("Data sources", datasources && datasources.map((d) => d.name)),
    line("Feature flags", features),
    line("Experiments", experiments && experiments.map((e) => e.name)),
    line("Fact metrics", factMetrics && factMetrics.map((m) => m.name)),
    line("Legacy metrics", legacyMetrics),
  ]
    .filter((l): l is string => l !== null)
    .join("\n");
}

/**
 * Model output → text to append. The model writes the whole message so word
 * spacing comes out naturally; the draft prefix is stripped here.
 */
export function cleanCompletion(raw: string, draft: string): string {
  const full = raw
    .replace(/\s+$/, "")
    .replace(/^\s*["'“”`]+|["'“”`]+$/g, "")
    .trimStart();
  const d = draft.trimStart();
  const lowerFull = full.toLowerCase();
  const lowerDraft = d.toLowerCase();
  // Output ran out mid-echo: nothing useful to append.
  if (
    lowerFull.length < lowerDraft.length &&
    lowerDraft.startsWith(lowerFull)
  ) {
    return "";
  }
  const echoed = lowerFull.startsWith(lowerDraft);
  // No echo: the model sent just a continuation, so assume it starts a new word.
  const out = echoed
    ? full.slice(d.length)
    : /\S$/.test(d) && /^\S/.test(full)
      ? ` ${full}`
      : full;
  const one = out.split("\n")[0].slice(0, 200).replace(/\s+$/, "");
  // Always a finished sentence, so what Tab inserts is ready to send.
  return one && !/[.?!]$/.test(one) ? `${one}.` : one;
}

export const postAutocomplete = async (
  req: AuthRequest<{
    text: string;
    conversationId?: string;
    currentPage?: string;
    datasourceId?: string;
  }>,
  res: Response,
) => {
  const context = getContextFromReq(req);
  if (!(await runAIEnabledGates(context, res))) return;
  // Opt-out separate from AI as a whole: every pause in typing is a call.
  if (context.org.settings?.aiAutocompleteEnabled === false) {
    return res.status(404).json({
      status: 404,
      message: "AI Assistant autocomplete is turned off for this organization",
    });
  }

  const secondsUntilReset = await secondsUntilAICanBeUsedAgainForPrompt(
    context,
    "chat-autocomplete",
  );
  if (secondsUntilReset > 0) {
    return res.status(429).json({
      status: 429,
      message: "Over AI usage limits",
      retryAfter: secondsUntilReset,
    });
  }

  const { text, conversationId, currentPage, datasourceId } = req.body;
  // getById is owner-scoped, so another user's conversation reads as missing.
  const [conversation, orgContext] = await Promise.all([
    conversationId
      ? context.models.aiConversations.getById(conversationId)
      : null,
    orgContextForAutocomplete(context, { datasourceId, currentPage }),
  ]);
  const history = (conversation?.messages ?? [])
    .filter(
      (m): m is AIChatUserMessage | AIChatAssistantMessage =>
        m.role === "user" || m.role === "assistant",
    )
    .slice(-6)
    .map((m) => `${m.role}: ${getMessageText(m).slice(0, 500)}`)
    .join("\n");
  // Only skills the org has on, so suggestions don't steer toward disabled ones.
  const skills = listSkillSummaries(context.org)
    .filter((s) => s.enabled && s.kind !== "domain")
    .map((s) => `- ${s.name}: ${s.description}`)
    .join("\n");

  const raw = await simpleCompletion({
    context,
    type: "chat-autocomplete",
    isDefaultPrompt: true,
    temperature: 0.2,
    // Room to echo the draft (~3 chars per token, generous) plus one short
    // sentence; anything longer is the model rambling.
    maxOutputTokens: Math.ceil(text.length / 3) + 80,
    instructions: AUTOCOMPLETE_INSTRUCTIONS,
    prompt: `Assistant skills:\n${skills}\n\nThis organization has:\n${orgContext}\n\nCurrent page: ${currentPage?.trim() || "(unknown)"}\n\nRecent conversation:\n${history || "(none)"}\n\nDraft:\n${text}`,
  });

  return res
    .status(200)
    .json({ status: 200, completion: cleanCompletion(raw, text) });
};
