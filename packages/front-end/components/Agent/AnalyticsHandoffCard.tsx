import { useRouter } from "next/router";
import { Flex } from "@radix-ui/themes";
import { tryParseToolResultJson, type AIChatMention } from "shared/ai-chat";
import Button from "@/ui/Button";
import Text from "@/ui/Text";
import { AssistantBubble } from "@/enterprise/components/AIChat/AIChatPrimitives";
import { PA_AI_CHAT_INITIAL_MESSAGE_KEY } from "@/enterprise/components/ProductAnalytics/util";

/** The brief the agent wrote, as it rides in the `openAnalyticsChat` result. */
export interface AnalyticsHandoff {
  prompt: string;
  mentions?: AIChatMention[];
}

/**
 * Pull a handoff out of an `openAnalyticsChat` tool result.
 *
 * Reads defensively, like the dashboard preview does: this is JSON that came
 * back through the model's tool loop, and a malformed one should render nothing
 * rather than throw inside the transcript.
 */
export function analyticsHandoffFromToolResult(
  result: unknown,
): AnalyticsHandoff | null {
  const parsed =
    typeof result === "string" ? tryParseToolResultJson(result) : result;

  if (!parsed || typeof parsed !== "object") return null;
  const { handoff } = parsed as { handoff?: unknown };
  if (!handoff || typeof handoff !== "object") return null;

  const { prompt, mentions } = handoff as {
    prompt?: unknown;
    mentions?: unknown;
  };
  if (typeof prompt !== "string" || !prompt.trim()) return null;

  return {
    prompt: prompt.trim(),
    mentions: Array.isArray(mentions)
      ? (mentions as AIChatMention[])
      : undefined,
  };
}

/**
 * The offer to continue a dashboard request in the Product Analytics chat.
 *
 * Clicking navigates rather than the tool doing it on its own: the panel floats
 * over whatever the user was working on, and moving them off that page is not
 * something to do behind their back. The brief goes through the same
 * sessionStorage stash the Product Analytics empty state uses, so the other
 * chat sends it as the opening message.
 */
export default function AnalyticsHandoffCard({
  handoff,
}: {
  handoff: AnalyticsHandoff;
}) {
  const router = useRouter();

  const open = () => {
    sessionStorage.setItem(
      PA_AI_CHAT_INITIAL_MESSAGE_KEY,
      JSON.stringify({
        text: handoff.prompt,
        mentions: handoff.mentions ?? [],
        // The other chat is scoped to the dashboard skills, and this is always
        // a build request — an edit never gets here.
        skills: ["dashboard-create"],
      }),
    );
    void router.push("/product-analytics/explore/ai-chat");
  };

  return (
    <AssistantBubble>
      <Flex direction="column" gap="2" align="start">
        <Text size="sm" weight="medium">
          Build this in the Analytics chat
        </Text>
        <Text size="sm" color="text-low">
          {handoff.prompt}
        </Text>
        <Button size="sm" onClick={open}>
          Open Analytics chat
        </Button>
      </Flex>
    </AssistantBubble>
  );
}
