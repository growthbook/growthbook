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
      menuWidth={300}
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
          <Text size="small" color="text-low">
            No previous chats yet.
          </Text>
        </Box>
      ) : (
        <Box
          style={{
            maxHeight: 360,
            overflowY: "auto",
            overflowX: "hidden",
            padding: "2px 4px",
          }}
        >
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
                  <span
                    style={{
                      display: "block",
                      // Hard cap (menu is 300px wide) so the longest title can't
                      // grow the Radix content to its max-content width, which
                      // is what was forcing horizontal scroll. Percent widths
                      // don't constrain a max-content-sized ancestor.
                      maxWidth: 248,
                      fontSize: 13,
                      lineHeight: 1.4,
                      fontWeight: isActive ? 600 : 500,
                      color: "var(--color-text-high)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {conv.title || "Untitled"}
                  </span>
                  <span
                    style={{
                      marginTop: 2,
                      fontSize: 11,
                      lineHeight: 1.2,
                      color: "var(--gray-a10)",
                    }}
                  >
                    {formatShortAgo(conv.createdAt)}
                  </span>
                </Flex>
              </DropdownMenuItem>
            );
          })}
        </Box>
      )}
    </DropdownMenu>
  );
}
