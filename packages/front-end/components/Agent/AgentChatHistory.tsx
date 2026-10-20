import { useCallback } from "react";
import { Box, Flex, IconButton } from "@radix-ui/themes";
import {
  PiCaretDownBold,
  PiRobotBold,
  PiChatCircleDots,
  PiClockCounterClockwise,
  PiPlus,
} from "react-icons/pi";
import { datetime, formatShortAgo } from "shared/dates";
import useApi from "@/hooks/useApi";
import Text from "@/ui/Text";
import Button from "@/ui/Button";
import {
  DropdownMenu,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/ui/DropdownMenu";
import type { ConversationSummary } from "@/enterprise/hooks/useAIChat";
import { AGENT_PANEL_PORTAL_Z_INDEX } from "./AgentPanelContext";
import { groupConversationsByRecency } from "./chatHistoryUtils";

const MENU_WIDTH = 300;
// ScrollArea's viewport is max-content sized, so a nowrap title needs a hard cap.
const ITEM_CONTENT_WIDTH = MENU_WIDTH - 48;

interface AgentChatHistoryProps {
  activeConversationId: string;
  /** Switch the panel to a previously persisted conversation. */
  onSelect: (id: string) => void;
  /**
   * PROTOTYPE (set in review), opt-in: one control for history and new
   * conversations. The trigger is the current conversation's title (or
   * "New Conversation") with a caret, on the left of the panel's header,
   * and the menu starts with "New Conversation". Without it, the clock
   * icon as before.
   */
  onNewChat?: () => void;
  /** With onNewChat: no new conversations (e.g. at the usage limit). */
  newChatDisabled?: boolean;
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
  onNewChat,
  newChatDisabled = false,
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

  // Combined (onNewChat): the current conversation's title, or "New
  // conversation" before it's saved with one.
  const combined = !!onNewChat;
  const currentTitle =
    conversations.find((c) => c.conversationId === activeConversationId)
      ?.title || "New Conversation";

  return (
    <DropdownMenu
      onOpenChange={handleOpenChange}
      menuPlacement={combined ? "start" : "end"}
      menuWidth={MENU_WIDTH}
      menuMaxHeight={420}
      menuZIndex={AGENT_PANEL_PORTAL_Z_INDEX}
      variant="soft"
      trigger={
        combined ? (
          // A ghost button, medium (set in review; tried outline, and
          // small), pulled left by its 12px padding (set in review) so its
          // text lines up with the panel's content below; its hover fill
          // reaches out into the margin, as ghost buttons do. The title
          // truncated to keep the right side's icons clear.
          <Button
            variant="ghost"
            color="gray"
            size="md"
            icon={<PiCaretDownBold size={12} />}
            iconPosition="right"
            aria-label={`${currentTitle}. Conversations: start a new one or open a recent one`}
            style={{
              maxWidth: "100%",
              // Shifted, not a margin: the app forces ghost buttons'
              // margins to 0 (.rt-Button.rt-variant-ghost, !important).
              position: "relative",
              left: "calc(-1 * var(--space-3))",
              color: "var(--slate-12)",
            }}
          >
            {/* GrowthBot's robot head (set in review; was a chat bubble,
              tried the comments icon), as the header's GrowthBot button,
              so the rail says whose conversations these are whatever the
              title; on one line with it (Button puts its children in a
              wrapper of their own, where they'd stack). */}
            <Flex as="span" align="center" gap="2" minWidth="0">
              <PiRobotBold
                size={16}
                aria-hidden="true"
                style={{ flexShrink: 0 }}
              />
              <span
                style={{
                  display: "block",
                  maxWidth: 200,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  fontWeight: 500,
                }}
              >
                {currentTitle}
              </span>
            </Flex>
          </Button>
        ) : (
          <IconButton
            variant="ghost"
            size="1"
            title="Chat history"
            aria-label="Chat history"
          >
            <PiClockCounterClockwise size={18} />
          </IconButton>
        )
      }
    >
      {onNewChat ? (
        <>
          <DropdownMenuItem
            onClick={onNewChat}
            disabled={newChatDisabled}
            style={{ padding: "8px 10px" }}
          >
            <Flex align="center" gap="2">
              <PiPlus size={14} aria-hidden="true" />
              New Conversation
            </Flex>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
        </>
      ) : null}
      {groups.length === 0 ? (
        // PROTOTYPE (set in review): as the experiment page's comments
        // empty state (RailComments.tsx): a 24px icon in --slate-10, the
        // title at md and 500 in --slate-12, the line under it at sm in
        // --slate-11, 8px apart, centred.
        <Flex direction="column" align="center" gap="2" px="4" py="6">
          <PiChatCircleDots
            size={24}
            aria-hidden
            style={{ color: "var(--slate-10)" }}
          />
          <Box style={{ color: "var(--slate-12)" }}>
            <Text as="div" align="center" size="md" weight="medium">
              No previous chats
            </Text>
          </Box>
          {/* --slate-11, off the text tokens, so set on the wrapper. */}
          <Box style={{ color: "var(--slate-11)", maxWidth: 240 }}>
            <Text as="div" align="center" size="sm">
              Your conversations will show up here.
            </Text>
          </Box>
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
