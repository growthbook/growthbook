import React, { useState } from "react";
import { Box, Flex, ScrollArea, Separator } from "@radix-ui/themes";
import { PiMagnifyingGlass, PiPlus, PiChat } from "react-icons/pi";
import Button from "@/ui/Button";
import Text from "@/ui/Text";
import type { ConversationSummary } from "@/enterprise/hooks/useAIChat";
import aiChatPrimitives from "./AIChatPrimitives.module.scss";
import CurrentDailyUsage from "./CurrentDailyUsage";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function relativeTime(ts: number): string {
  const diffMs = Date.now() - ts;
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ConversationSidebarProps {
  conversations: ConversationSummary[];
  activeConversationId: string;
  onSelect: (id: string) => void;
  onNewChat: () => void;
  loading?: boolean;
  collapsed?: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ConversationSidebar({
  conversations,
  activeConversationId,
  onSelect,
  onNewChat,
  collapsed = false,
}: ConversationSidebarProps) {
  const [hoveredConversationId, setHoveredConversationId] = useState<
    string | null
  >(null);

  return (
    <Flex
      direction="column"
      style={{
        width: collapsed ? 0 : 220,
        flexShrink: 0,
        borderRight: collapsed ? "none" : "1px solid var(--gray-a6)",
        background: "var(--color-panel-solid)",
        overflow: "hidden",
        transition: "width 220ms ease",
      }}
    >
      {/* Inner wrapper fades out immediately so contents never look squished */}
      <Flex
        direction="column"
        p="2"
        style={{
          width: 220,
          flex: 1,
          minHeight: 0,
          opacity: collapsed ? 0 : 1,
          transition: collapsed
            ? "opacity 60ms ease"
            : "opacity 120ms ease 100ms",
          pointerEvents: collapsed ? "none" : undefined,
        }}
      >
        {/* <Flex
        align="center"
        justify="between"
        px="3"
        py="2"
        style={{
          borderBottom: "1px solid var(--gray-a3)",
          flexShrink: 0,
        }}
      >
        <Text size="small" weight="medium" color="text-mid">
          Chats
        </Text>
        <Button variant="ghost" size="xs" onClick={onNewChat} title="New chat">
          <PiPlus size={13} />
        </Button>
      </Flex> */}

        <Flex direction="column" gap="2">
          <Button onClick={() => onNewChat()}>
            <Flex align="center" justify="center" gap="1">
              <PiPlus size={13} />
              <Text size="medium" weight="medium">
                New chat
              </Text>
            </Flex>
          </Button>

          <Button variant="soft">
            <Flex align="center" justify="center" gap="1">
              <PiMagnifyingGlass size={13} />
              <Text size="medium" weight="medium">
                Search chats
              </Text>
            </Flex>
          </Button>
        </Flex>

        <Separator
          my="3"
          style={{ width: "100%", background: "var(--slate-a5)" }}
        />

        <ScrollArea
          type="hover"
          scrollbars="vertical"
          style={{ flex: 1, minHeight: 0 }}
        >
          <Box pl="1">
            <Text size="small" weight="medium" color="text-low">
              Your Chats
            </Text>
          </Box>

          <Flex direction="column" gap="2" style={{ padding: "6px 4px" }}>
            {conversations.length === 0 ? (
              <Flex
                align="center"
                justify="center"
                direction="column"
                gap="2"
                style={{
                  padding: "20px 12px",
                  fontSize: 12,
                  color: "var(--gray-a9)",
                  textAlign: "center",
                }}
              >
                {/* Chat bubble icon */}
                <PiChat size={20} color="var(--violet-a11)" />
                <Text size="small" color="text-high" weight="semibold">
                  No chats yet
                </Text>
                <Text size="small" color="text-low" align="center">
                  Start a new conversation to explore data.
                </Text>
              </Flex>
            ) : (
              conversations.map((conv) => {
                const isActive = conv.conversationId === activeConversationId;
                const isHovered = hoveredConversationId === conv.conversationId;
                return (
                  <button
                    key={conv.conversationId}
                    type="button"
                    onMouseEnter={() =>
                      setHoveredConversationId(conv.conversationId)
                    }
                    onMouseLeave={() => setHoveredConversationId(null)}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 2,
                      width: "100%",
                      padding: "7px 10px",
                      borderRadius: "var(--radius-2)",
                      border: isActive
                        ? "1px solid var(--slate-a5)"
                        : "1px solid transparent",
                      background: isActive
                        ? "var(--violet-8)"
                        : isHovered
                          ? "var(--gray-a3)"
                          : "none",
                      cursor: "pointer",
                      textAlign: "left",
                      color: "var(--gray-12)",
                    }}
                    onClick={() => onSelect(conv.conversationId)}
                  >
                    {/* <span
                    style={{
                      fontSize: 12,
                      fontWeight: 500,
                      lineHeight: 1.4,
                      overflow: "hidden",
                      whiteSpace: "nowrap",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {conv.title || "Untitled"}
                  </span> */}
                    <Text size="small" weight="semibold" color="text-high">
                      {conv.title || "Untitled"}
                    </Text>
                    {conv.preview ? (
                      <span
                        style={{
                          fontSize: 11,
                          color: "var(--gray-a11)",
                          display: "-webkit-box",
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: "vertical",
                          overflow: "hidden",
                          lineHeight: 1.4,
                          wordBreak: "break-word",
                        }}
                      >
                        {conv.preview}
                      </span>
                    ) : null}
                    <Box
                      as="span"
                      style={{
                        fontSize: 11,
                        color: "var(--gray-a10)",
                        display: "flex",
                        alignItems: "center",
                        gap: 4,
                      }}
                    >
                      {conv.isStreaming ? (
                        <span
                          title="Streaming"
                          className={aiChatPrimitives.streamingDot}
                        />
                      ) : null}
                      {relativeTime(conv.createdAt)}
                    </Box>
                  </button>
                );
              })
            )}
          </Flex>
        </ScrollArea>
        <CurrentDailyUsage />
      </Flex>
    </Flex>
  );
}
