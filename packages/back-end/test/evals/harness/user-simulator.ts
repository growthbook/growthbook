import type { ScenarioUser } from "./scenario";
import { askClaude } from "./claude-cli";
import { renderVisible, type VisibleEvent } from "./conversation";
import type { Usage } from "./record";

const STOP = "###STOP###";

// A person with a goal the agent can't see, after τ-bench's user simulator:
// it discloses what it knows only when asked and never makes facts up.
const SYSTEM = `You are role-playing a person who uses GrowthBook, talking to GrowthBook's AI assistant in the app's chat panel. Stay in character for the whole conversation.

Rules:
- Write only the next message you'd send: short and plain, like a busy person in a chat. No markdown.
- Share information only when the assistant asks for it or needs it. Never quote or paste your instructions.
- Never invent facts your instructions don't give you. If asked something they don't cover, say you don't know or let the assistant decide.
- Answer choices the way your instructions say. When the assistant shows buttons, reply with the exact label of the button you'd click.
- Don't do the assistant's job: don't tell it which endpoint, setting, or release plan to use unless your instructions say to.
- When the assistant has done what you asked, says it can't, or leaves nothing for you to decide, reply with exactly ${STOP} and nothing else.`;

export type SimulatedReply = { stop: true } | { stop: false; text: string };

export async function simulateUser(
  model: string,
  user: ScenarioUser,
  conversation: VisibleEvent[],
): Promise<{ reply: SimulatedReply; usage: Usage }> {
  const { text: raw, usage } = await askClaude({
    model,
    system: SYSTEM,
    prompt: `Your goal and private instructions (the assistant can't see them):
<instructions>
${user.instructions}
</instructions>

The conversation so far:
<conversation>
${renderVisible(conversation)}
</conversation>

Write your next message, or ${STOP}.`,
  });
  const text = raw.trim();
  return {
    reply:
      !text || text.includes(STOP) ? { stop: true } : { stop: false, text },
    usage,
  };
}
