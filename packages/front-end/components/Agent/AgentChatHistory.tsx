import React, { useCallback } from "react";
import { Box, Flex, IconButton } from "@radix-ui/themes";
import { PiClockCounterClockwise } from "react-icons/pi";
import { formatShortAgo } from "shared/dates";
import useApi from "@/hooks/useApi";
import Text from "@/ui/Text";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/ui/DropdownMenu";
import type { ConversationSummary } from "@/enterprise/hooks/useAIChat";

const MENU_WIDTH = 300;
// Menu width minus item + viewport padding. The menu's built-in ScrollArea
// viewport is max-content sized, so a nowrap title needs a hard cap to
// truncate instead of widening the menu.
const TITLE_MAX_WIDTH = MENU_WIDTH - 48;

interface AgentChatHistoryProps {
  activeConversationId: string;
  /** Switch the panel to a previously persisted conversation. */
  onSelect: (id: string) => void;
}

/**
 * Clock-icon dropdown in the agent panel header listing the user's recent
 * conversations (newest-first). Selecting one loads it into the panel. The
 * list is refetched each time the menu opens so freshly persisted chats
 * appear without a manual refresh.
 */
export default function AgentChatHistory({
  activeConversationId,
  onSelect,
}: AgentChatHistoryProps) {
  const { data, mutate } = useApi<{ conversations: ConversationSummary[] }>(
    "/agent/chat",
  );
  const conversations = data?.conversations ?? [];

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (open) void mutate();
    },
    [mutate],
  );

  return (
    <DropdownMenu
      onOpenChange={handleOpenChange}
      menuPlacement="end"
      menuWidth={MENU_WIDTH}
      menuMaxHeight={360}
      trigger={
        <IconButton
          variant="ghost"
          size="1"
          title="Chat history"
          aria-label="Chat history"
        >
          <PiClockCounterClockwise size={16} />
        </IconButton>
      }
    >
      <DropdownMenuLabel>Chat history</DropdownMenuLabel>
      <DropdownMenuSeparator />
      {conversations.length === 0 ? (
        <Box px="3" py="2">
          <Text size="sm" color="text-low">
            No previous chats yet.
          </Text>
        </Box>
      ) : (
        <>
          {conversations.map((conv, idx) => {
            const isActive = conv.conversationId === activeConversationId;
            const isLast = idx === conversations.length - 1;
            return (
              <DropdownMenuItem
                key={conv.conversationId}
                onClick={() => onSelect(conv.conversationId)}
                style={{
                  height: "auto",
                  minWidth: 0,
                  maxWidth: "100%",
                  overflow: "hidden",
                  padding: "5px 10px",
                  borderRadius: 0,
                  borderBottom: isLast ? undefined : "1px solid var(--gray-a3)",
                }}
              >
                <Flex
                  direction="column"
                  gap="0"
                  style={{ minWidth: 0, width: "100%", overflow: "hidden" }}
                >
                  <Box style={{ maxWidth: TITLE_MAX_WIDTH }}>
                    <Text
                      as="div"
                      size="sm"
                      weight={isActive ? "semibold" : "medium"}
                      truncate
                      title={conv.title || "Untitled"}
                    >
                      {conv.title || "Untitled"}
                    </Text>
                  </Box>
                  {/* Opacity, not a text color, so it flips with the item's highlight. */}
                  <Box style={{ marginTop: 2, opacity: 0.7 }}>
                    <Text as="div" size="sm">
                      {formatShortAgo(conv.createdAt)}
                    </Text>
                  </Box>
                </Flex>
              </DropdownMenuItem>
            );
          })}
        </>
      )}
    </DropdownMenu>
  );
}
