import type { Response } from "express";
import type { SkillSummary } from "shared/ai-chat";
import type { AuthRequest } from "back-end/src/types/AuthRequest";
import { postGeneralAgentChat } from "back-end/src/agent/general-agent";
import { makeListChats } from "back-end/src/routers/utils/chat-controllers";
import { getAllSkills } from "back-end/src/agent/skills";

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
  const skills = getAllSkills().map(({ name, description, kind, group }) => ({
    name,
    description,
    kind,
    ...(group !== undefined ? { group } : {}),
  }));

  return res.status(200).json({ status: 200, skills });
};
