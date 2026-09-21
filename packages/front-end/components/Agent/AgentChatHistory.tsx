import { useCallback } from "react";
import { Box, Flex, IconButton } from "@radix-ui/themes";
import { PiChatCircleDots, PiClockCounterClockwise } from "react-icons/pi";
import { datetime, formatShortAgo } from "shared/dates";
import useApi from "@/hooks/useApi";
import Text from "@/ui/Text";
import {
  DropdownMenu,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
} from "@/ui/DropdownMenu";
import type { ConversationSummary } from "@/enterprise/hooks/useAIChat";
import { AGENT_PANEL_PORTAL_Z_INDEX } from "./AgentPanelContext";
import { groupConversationsByRecency } from "./chatHistoryUtils";

const MENU_WIDTH = 300;
// Menu width minus content padding, item padding, and the scrollbar gutter the
// ScrollArea adds when the list overflows. The viewport is max-content sized,
// so a nowrap title needs a hard cap to truncate instead of widening the menu.
const ITEM_CONTENT_WIDTH = MENU_WIDTH - 48;

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
  const groups = groupConversationsByRecency(conversations);

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
      menuMaxHeight={420}
      menuZIndex={AGENT_PANEL_PORTAL_Z_INDEX}
      variant="soft"
      trigger={
        <IconButton
          variant="ghost"
          size="1"
          title="Chat history"
          aria-label="Chat history"
        >
          <PiClockCounterClockwise size={18} />
        </IconButton>
      }
    >
      {groups.length === 0 ? (
        <Flex
          direction="column"
          align="center"
          gap="2"
          px="4"
          py="6"
          style={{ color: "var(--color-text-low)" }}
        >
          <PiChatCircleDots size={22} />
          <Text size="sm" weight="medium" color="text-mid" align="center">
            No previous chats
          </Text>
          <Text size="sm" color="text-low" align="center">
            Your conversations will show up here.
          </Text>
        </Flex>
      ) : (
        groups.map((group, groupIdx) => (
          <DropdownMenuGroup key={group.label}>
            <DropdownMenuLabel
              textSize="sm"
              style={{
                height: "auto",
                padding: "6px 10px 2px",
                marginTop: groupIdx === 0 ? 0 : 6,
              }}
              textStyle={{
                fontSize: 11,
                fontWeight: 500,
                letterSpacing: "0.04em",
                textTransform: "uppercase",
              }}
            >
              {group.label}
            </DropdownMenuLabel>
            {group.conversations.map((conv, idx) => (
              <ConversationItem
                key={conv.conversationId}
                conversation={conv}
                isActive={conv.conversationId === activeConversationId}
                isLastInGroup={idx === group.conversations.length - 1}
                onSelect={onSelect}
              />
            ))}
          </DropdownMenuGroup>
        ))
      )}
    </DropdownMenu>
  );
}

function ConversationItem({
  conversation: conv,
  isActive,
  isLastInGroup,
  onSelect,
}: {
  conversation: ConversationSummary;
  isActive: boolean;
  isLastInGroup: boolean;
  onSelect: (id: string) => void;
}) {
  const title = conv.title || "Untitled";
  const created = new Date(conv.createdAt);

  return (
    <DropdownMenuItem
      onClick={() => onSelect(conv.conversationId)}
      style={{
        height: "auto",
        minWidth: 0,
        padding: "8px 8px 8px 10px",
        borderRadius: 0,
        borderBottom: isLastInGroup ? undefined : "1px solid var(--gray-a3)",
        // Inset so the current-chat marker doesn't add width.
        boxShadow: isActive ? "inset 2px 0 0 var(--violet-9)" : undefined,
      }}
    >
      <Flex
        direction="column"
        gap="1"
        style={{ width: ITEM_CONTENT_WIDTH, minWidth: 0 }}
      >
        <Text
          as="div"
          size="md"
          weight={isActive ? "semibold" : "medium"}
          color="text-high"
          truncate
          title={title}
        >
          {title}
        </Text>
        <Flex align="center" gap="2" style={{ minWidth: 0 }}>
          {conv.preview ? (
            <Box style={{ flex: 1, minWidth: 0 }}>
              <Text as="div" size="sm" color="text-low" truncate>
                {conv.preview}
              </Text>
            </Box>
          ) : (
            <Box style={{ flex: 1 }} />
          )}
          <Text
            as="div"
            size="sm"
            color="text-low"
            whiteSpace="nowrap"
            title={datetime(created)}
          >
            {formatShortAgo(created)}
          </Text>
        </Flex>
      </Flex>
    </DropdownMenuItem>
  );
}
