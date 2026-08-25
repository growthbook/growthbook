import { useRouter } from "next/router";
import { Flex } from "@radix-ui/themes";
import { parseToolResult } from "shared/ai-chat";
import {
  analyticsHandoffResultValidator,
  type AnalyticsHandoff,
} from "shared/validators";
import Button from "@/ui/Button";
import Text from "@/ui/Text";
import { AssistantBubble } from "@/enterprise/components/AIChat/AIChatPrimitives";
import { PA_AI_CHAT_INITIAL_MESSAGE_KEY } from "@/enterprise/components/ProductAnalytics/util";

/** Pull a handoff out of an `openAnalyticsChat` tool result. */
export function analyticsHandoffFromToolResult(
  result: unknown,
): AnalyticsHandoff | null {
  return (
    parseToolResult(result, analyticsHandoffResultValidator)?.handoff ?? null
  );
}

/** The user clicks rather than the tool navigating them off the page. */
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
        // Always a build request; an edit never reaches this card.
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
