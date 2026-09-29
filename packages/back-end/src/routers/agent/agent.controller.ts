import type { Response } from "express";
import {
  getMessageText,
  type AIChatAssistantMessage,
  type AIChatUserMessage,
  type SkillSummary,
} from "shared/ai-chat";
import type { AuthRequest } from "back-end/src/types/AuthRequest";
import { postGeneralAgentChat } from "back-end/src/agent/general-agent";
import { makeListChats } from "back-end/src/routers/utils/chat-controllers";
import { listSkillSummaries } from "back-end/src/agent/skills";
import { getContextFromReq } from "back-end/src/services/organizations";
import {
  secondsUntilAICanBeUsedAgainForPrompt,
  simpleCompletion,
} from "back-end/src/enterprise/services/ai";
import { runAIEnabledGates } from "back-end/src/enterprise/services/ai-access";

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
  res: Response<{ status: 200; skills: SkillSummary[] }>,
): Promise<Response> => {
  return res
    .status(200)
    .json({ status: 200, skills: [...listSkillSummaries()] });
};

const AUTOCOMPLETE_INSTRUCTIONS = `You autocomplete a draft message a user is typing to GrowthBook's AI assistant.
Reply with ONLY the text to append after the draft, nothing else: no quotes, no explanation, never repeat the draft.
If the draft ends mid-word, finish that word. If it ends on a complete word, begin with a space.
Finish the user's thought in one short sentence (under 15 words). Prefer requests the assistant's skills below can carry out, and use the recent conversation to guess what they want next.
Reply with an empty string if there is no good continuation.`;

/** Model output → text to append. Keeps a leading space; drops echoes and wrapping quotes. */
export function cleanCompletion(raw: string, draft: string): string {
  let out = raw.replace(/\s+$/, "").replace(/^\s*["'“”`]+|["'“”`]+$/g, "");
  if (out.trimStart().startsWith(draft)) {
    out = out.trimStart().slice(draft.length);
  }
  return out.split("\n")[0].slice(0, 200);
}

export const postAutocomplete = async (
  req: AuthRequest<{ text: string; conversationId?: string }>,
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

  const { text, conversationId } = req.body;
  // getById is owner-scoped, so another user's conversation reads as missing.
  const conversation = conversationId
    ? await context.models.aiConversations.getById(conversationId)
    : null;
  const history = (conversation?.messages ?? [])
    .filter(
      (m): m is AIChatUserMessage | AIChatAssistantMessage =>
        m.role === "user" || m.role === "assistant",
    )
    .slice(-6)
    .map((m) => `${m.role}: ${getMessageText(m).slice(0, 500)}`)
    .join("\n");
  const skills = listSkillSummaries()
    .filter((s) => s.kind !== "domain")
    .map((s) => `- ${s.name}: ${s.description}`)
    .join("\n");

  const raw = await simpleCompletion({
    context,
    type: "chat-autocomplete",
    isDefaultPrompt: true,
    temperature: 0.2,
    instructions: AUTOCOMPLETE_INSTRUCTIONS,
    prompt: `Assistant skills:\n${skills}\n\nRecent conversation:\n${history || "(none)"}\n\nDraft:\n${text}`,
  });

  return res
    .status(200)
    .json({ status: 200, completion: cleanCompletion(raw, text) });
};
