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
// Which entity lists a page makes relevant. First match wins.
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

// What the draft itself is about, when the page says nothing.
const DRAFT_CONTEXT: ReadonlyArray<[RegExp, ContextKind[]]> = [
  [
    /\b(flags?|features?|rollouts?|targeting|saved groups?|attributes?|environments?)\b/i,
    ["features"],
  ],
  [
    /\b(experiments?|a\/b|ab tests?|variations?|bandits?|holdouts?|hypothes[ie]s|results)\b/i,
    ["experiments", "metrics"],
  ],
  [
    /\b(metrics?|conversions?|revenue|funnels?|retention|kpis?)\b/i,
    ["metrics", "datasources"],
  ],
  [
    /\b(data ?sources?|warehouses?|tables?|sql|quer(y|ies)|dashboards?|charts?|analytics)\b/i,
    ["datasources", "metrics"],
  ],
];

// Skill domains each entity list belongs to; docs are always worth having.
const DOMAIN_FOR_KIND: Record<ContextKind, string> = {
  features: "feature-flags",
  experiments: "experiments",
  metrics: "analytics",
  datasources: "analytics",
};
const ALWAYS_DOMAINS = ["growthbook-docs"];

/**
 * Entity lists worth sending: whatever the page, the words in the draft and
 * the words in the recent conversation point at, combined. null means there
 * is nothing to ground a suggestion in yet.
 */
export function contextKindsFor({
  currentPage,
  text,
  historyText = "",
}: {
  currentPage?: string;
  text: string;
  historyText?: string;
}): ContextKind[] | null {
  const path = (currentPage ?? "").split("?")[0];
  const kinds = new Set<ContextKind>(
    PAGE_CONTEXT.find(([re]) => re.test(path))?.[1] ?? [],
  );
  for (const source of [text, historyText]) {
    DRAFT_CONTEXT.filter(([re]) => re.test(source)).forEach(([, ks]) =>
      ks.forEach((k) => kinds.add(k)),
    );
  }
  return kinds.size ? ALL_CONTEXT.filter((k) => kinds.has(k)) : null;
}

/** Descriptions run to a paragraph; the first sentence is enough to route by. */
export function firstSentence(text: string, max = 160): string {
  const first = text.trim().split(/(?<=[.!?])\s/)[0] ?? "";
  return first.length > max ? `${first.slice(0, max - 1).trimEnd()}…` : first;
}

/** Enabled leaf skills in the domains the context points at, one line each. */
function skillsForPrompt(org: ReqContext["org"], kinds: ContextKind[]): string {
  const domains = new Set([
    ...ALWAYS_DOMAINS,
    ...kinds.map((k) => DOMAIN_FOR_KIND[k]),
  ]);
  return listSkillSummaries(org)
    .filter(
      (s) => s.enabled && s.kind !== "domain" && domains.has(s.group ?? ""),
    )
    .map((s) => `- ${s.name}: ${firstSentence(s.description)}`)
    .join("\n");
}

/**
 * Names of the org's entities the context points at, so suggestions point at
 * real things without spending tokens on irrelevant lists. Metrics are scoped
 * to the active PA datasource when known.
 */
// ponytail: up to five queries per call; cache per org for a minute if this shows up in latency.
async function orgContextForAutocomplete(
  context: ReqContext,
  {
    datasourceId,
    kinds: kindList,
  }: { datasourceId?: string; kinds: ContextKind[] },
): Promise<string> {
  const kinds = new Set(kindList);
  // Lets the feature and metric lookups filter by read access in Mongo, so
  // their limits stay bounded on large catalogs. null means every project.
  const readableProjects =
    kinds.has("features") || kinds.has("metrics")
      ? context.permissions.getProjectsWithPermission(
          "readData",
          await context.models.projects.getAllIdsForOrg(),
        )
      : null;
  const want = <T>(kind: ContextKind, fetch: () => Promise<T[]>) =>
    kinds.has(kind) ? fetch() : Promise.resolve(null);

  const [datasources, features, experiments, factMetrics, legacyMetrics] =
    await Promise.all([
      want("datasources", () => getDataSourcesByOrganization(context)),
      want("features", () =>
        getRecentFeatureIds(context, {
          limit: ORG_CONTEXT_LIMIT,
          readableProjects,
        }),
      ),
      want("experiments", () =>
        getAllExperiments(context, {
          limit: ORG_CONTEXT_LIMIT,
          sortBy: { dateUpdated: -1 },
        }),
      ),
      want("metrics", () =>
        context.models.factMetrics.getRecentNamesForPrompt({
          limit: ORG_CONTEXT_LIMIT,
          datasourceId,
          readableProjects,
        }),
      ),
      want("metrics", () =>
        getRecentMetricNames(context, {
          limit: ORG_CONTEXT_LIMIT,
          datasourceId,
          readableProjects,
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
    line("Fact metrics", factMetrics),
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
  const conversation = conversationId
    ? await context.models.aiConversations.getById(conversationId)
    : null;
  const turns = (conversation?.messages ?? []).filter(
    (m): m is AIChatUserMessage | AIChatAssistantMessage =>
      m.role === "user" || m.role === "assistant",
  );
  const history = turns
    .slice(-6)
    .map((m) => `${m.role}: ${getMessageText(m).slice(0, 500)}`)
    .join("\n");
  const kinds = contextKindsFor({ currentPage, text, historyText: history });
  // Nothing to ground a suggestion in yet: no telling page, draft or
  // conversation. Guessing here is what produced invented metrics.
  if (!kinds) return res.status(200).json({ status: 200, completion: "" });

  const orgContext = await orgContextForAutocomplete(context, {
    datasourceId,
    kinds,
  });
  // Only enabled skills in the domains the context points at.
  const skills = skillsForPrompt(context.org, kinds);

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
