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
import { getMetricsByOrganization } from "back-end/src/models/MetricModel";

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
Keep the continuation to one short sentence (under 15 words). Prefer requests the assistant's skills below can carry out, and use the recent conversation to guess what they want next.
The user's current page in the GrowthBook app is given as a path: /features/<key> is that feature flag, /experiment/<id> that experiment, /metric/<id> or /fact-metrics/<id> that metric. When the draft says "this experiment", "this flag" or similar, it means the entity on that page.
Ground the continuation in what this organization actually has, listed below. Refer to those data sources, feature flags, experiments and metrics by their real names. Never invent a metric, flag, experiment or table that isn't listed; if nothing listed fits, keep the continuation generic.
Reply with the draft unchanged if there is no good continuation.`;

const ORG_CONTEXT_LIMIT = 15;

/** The org's most relevant entity names, so suggestions point at real things. */
// ponytail: four queries per call; cache per org for a minute if this shows up in latency.
async function orgContextForAutocomplete(context: ReqContext): Promise<string> {
  const [datasources, features, experiments, metrics] = await Promise.all([
    getDataSourcesByOrganization(context),
    getRecentFeatureIds(context, ORG_CONTEXT_LIMIT),
    getAllExperiments(context, {
      limit: ORG_CONTEXT_LIMIT,
      sortBy: { dateUpdated: -1 },
    }),
    Promise.all([
      context.models.factMetrics.getAllSorted(),
      getMetricsByOrganization(context, { includeArchived: false }),
    ]).then(([fact, legacy]) => [...fact, ...legacy]),
  ]);
  const line = (label: string, names: string[]) =>
    `${label}: ${names.length ? names.slice(0, ORG_CONTEXT_LIMIT).join(", ") : "(none)"}`;
  return [
    line(
      "Data sources",
      datasources.map((d) => d.name),
    ),
    line("Feature flags", features),
    line(
      "Experiments",
      experiments.map((e) => e.name),
    ),
    line(
      "Metrics",
      metrics.map((m) => m.name),
    ),
  ].join("\n");
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
  const echoed = full.toLowerCase().startsWith(d.toLowerCase());
  // No echo: the model sent just a continuation, so assume it starts a new word.
  const out = echoed
    ? full.slice(d.length)
    : /\S$/.test(d) && /^\S/.test(full)
      ? ` ${full}`
      : full;
  return out.split("\n")[0].slice(0, 200);
}

export const postAutocomplete = async (
  req: AuthRequest<{
    text: string;
    conversationId?: string;
    currentPage?: string;
  }>,
  res: Response,
) => {
  const context = getContextFromReq(req);
  if (!(await runAIEnabledGates(context, res))) return;

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

  const { text, conversationId, currentPage } = req.body;
  // getById is owner-scoped, so another user's conversation reads as missing.
  const [conversation, orgContext] = await Promise.all([
    conversationId
      ? context.models.aiConversations.getById(conversationId)
      : null,
    orgContextForAutocomplete(context),
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
    instructions: AUTOCOMPLETE_INSTRUCTIONS,
    prompt: `Assistant skills:\n${skills}\n\nThis organization has:\n${orgContext}\n\nCurrent page: ${currentPage?.trim() || "(unknown)"}\n\nRecent conversation:\n${history || "(none)"}\n\nDraft:\n${text}`,
  });

  return res
    .status(200)
    .json({ status: 200, completion: cleanCompletion(raw, text) });
};
