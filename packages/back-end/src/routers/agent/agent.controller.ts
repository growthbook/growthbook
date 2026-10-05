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
Reply with ONLY the complete message: the draft exactly as written, character for character, plus the next few words. No quotes, no explanation.
Add only the next phrase, at most 8 words; do not finish the whole sentence unless the thought is nearly complete. If the draft ends in the beginning of a name, finish that name from the lists below and stop.
The user's current page in the GrowthBook app is given as a path: /features/<key> is that feature flag, /experiment/<id> that experiment, /metric/<id> or /fact-metrics/<id> that metric. When the draft says "this experiment", "this flag" or similar, it means the entity on that page.
Ground the continuation in what this organization actually has, listed below. Refer to those data sources, feature flags, experiments and metrics by their real names. Never invent a metric, flag, experiment or table that isn't listed; if nothing listed fits, keep the continuation generic.
Reply with the draft unchanged if there is no good continuation.`;

const ORG_CONTEXT_LIMIT = 15;

type ContextKind = "datasources" | "features" | "experiments" | "metrics";
/**
 * What points at each entity list. `pages` are first path segments and
 * `words` are things people type or the assistant said; both accept a plural
 * "s", and a word may be a small regex fragment where plurals are irregular.
 * To cover a new page or term, add it to the matching group.
 */
const CONTEXT_SIGNALS: ReadonlyArray<{
  kinds: ContextKind[];
  pages: string[];
  words: string[];
}> = [
  {
    kinds: ["features"],
    pages: [
      "feature",
      "config",
      "constant",
      "saved-group",
      "attribute",
      "environment",
      "namespace",
      "archetype",
      "sdk",
    ],
    words: [
      "flag",
      "feature",
      "rollout",
      "targeting",
      "attribute",
      "environment",
    ],
  },
  {
    kinds: ["experiments", "metrics"],
    pages: [
      "experiment",
      "bandit",
      "contextual-bandit",
      "holdout",
      "report",
      "learning",
      "idea",
      "power-calculator",
      "presentation",
      "present",
    ],
    words: [
      "experiment",
      "variation",
      "bandit",
      "holdout",
      "hypothes[ie]s",
      "result",
    ],
  },
  {
    kinds: ["metrics", "datasources"],
    pages: [
      "metric",
      "fact-metric",
      "fact-table",
      "metric-group",
      "segment",
      "dimension",
      "metric-effect",
      "correlation",
    ],
    words: ["metric", "conversion", "revenue", "funnel", "retention", "kpi"],
  },
  {
    kinds: ["datasources", "metrics"],
    pages: [
      "product-analytics",
      "datasource",
      "sql-explorer",
      "session-replay",
    ],
    words: [
      "data ?source",
      "warehouse",
      "table",
      "sql",
      "quer(?:y|ies)",
      "dashboard",
      "chart",
      "analytic",
    ],
  },
];
const SIGNALS = CONTEXT_SIGNALS.map(({ kinds, pages, words }) => ({
  kinds,
  page: new RegExp(`^(?:${pages.join("|")})s?$`),
  words: new RegExp(`\\b(?:${words.join("|")})s?\\b`, "i"),
}));

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
  const segment = (currentPage ?? "").split("?")[0].split("/")[1] ?? "";
  const said = `${text} ${historyText}`;
  const kinds = new Set<ContextKind>();
  for (const { kinds: ks, page, words } of SIGNALS) {
    if (page.test(segment) || words.test(said)) ks.forEach((k) => kinds.add(k));
  }
  return kinds.size ? [...kinds] : null;
}

/** Descriptions run to a paragraph; the first sentence is enough to route by. */
export function firstSentence(text: string): string {
  return text.trim().split(/(?<=[.!?])\s/)[0] ?? "";
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

/** Labelled name lists for the entity kinds the context points at. */
// ponytail: up to five queries per call; cache per org for a minute if this shows up in latency.
async function entityNames(
  context: ReqContext,
  {
    datasourceId,
    kinds: kindList,
  }: { datasourceId?: string; kinds: ContextKind[] },
): Promise<(readonly [string, string[]])[]> {
  const kinds = new Set(kindList);
  const limit = ORG_CONTEXT_LIMIT;
  // Lets the feature and metric lookups filter by read access in Mongo, so
  // their limits stay bounded on large catalogs. null means every project.
  const readableProjects =
    kinds.has("features") || kinds.has("metrics")
      ? context.permissions.getProjectsWithPermission(
          "readData",
          await context.models.projects.getAllIdsForOrg(),
        )
      : null;
  const sources: [string, ContextKind, () => Promise<string[]>][] = [
    [
      "Data sources",
      "datasources",
      async () =>
        (await getDataSourcesByOrganization(context)).map((d) => d.name),
    ],
    [
      "Feature flags",
      "features",
      () => getRecentFeatureIds(context, { limit, readableProjects }),
    ],
    [
      "Experiments",
      "experiments",
      async () =>
        (
          await getAllExperiments(context, {
            limit,
            sortBy: { dateUpdated: -1 },
          })
        ).map((e) => e.name),
    ],
    [
      "Fact metrics",
      "metrics",
      () =>
        context.models.factMetrics.getRecentNamesForPrompt({
          limit,
          datasourceId,
          readableProjects,
        }),
    ],
    [
      "Legacy metrics",
      "metrics",
      () =>
        getRecentMetricNames(context, {
          limit,
          datasourceId,
          readableProjects,
        }),
    ],
  ];
  return Promise.all(
    sources
      .filter(([, kind]) => kinds.has(kind))
      .map(async ([label, , fetch]) => [label, await fetch()] as const),
  );
}

/**
 * Model output → text to append. The model writes the whole message so word
 * spacing comes out naturally; the draft prefix is stripped here.
 */
export function cleanCompletion(raw: string, draft: string): string {
  const full = raw
    .trimEnd()
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
    : d && d === d.trimEnd() && full
      ? ` ${full}`
      : full;
  return out.split("\n")[0].slice(0, 120).trimEnd();
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

  const orgContext = (await entityNames(context, { datasourceId, kinds }))
    .map(([label, names]) => `${label}: ${names.join(", ") || "(none)"}`)
    .join("\n");
  // Only enabled skills in the domains the context points at.
  const skills = skillsForPrompt(context.org, kinds);

  const raw = await simpleCompletion({
    context,
    type: "chat-autocomplete",
    isDefaultPrompt: true,
    temperature: 0.2,
    // Room to echo the draft (~3 chars per token, generous) plus a short
    // phrase; anything longer is the model rambling.
    maxOutputTokens: Math.ceil(text.length / 3) + 24,
    instructions: AUTOCOMPLETE_INSTRUCTIONS,
    prompt: `Assistant skills:\n${skills}\n\nThis organization has:\n${orgContext}\n\nCurrent page: ${currentPage?.trim() || "(unknown)"}\n\nRecent conversation:\n${history || "(none)"}\n\nDraft:\n${text}`,
  });

  return res
    .status(200)
    .json({ status: 200, completion: cleanCompletion(raw, text) });
};
