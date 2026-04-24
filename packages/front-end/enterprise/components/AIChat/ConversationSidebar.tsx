import React, { useState } from "react";
import { Box, Flex, ScrollArea, Separator } from "@radix-ui/themes";
import { PiMagnifyingGlass, PiPlus, PiChat, PiTrash } from "react-icons/pi";
import { formatShortAgo } from "shared/dates";
import track from "@/services/track";
import Button from "@/ui/Button";
import Text from "@/ui/Text";
import Modal from "@/components/Modal";
import type { ConversationSummary } from "@/enterprise/hooks/useAIChat";
import aiChatPrimitives from "./AIChatPrimitives.module.scss";
import AIUsageWidget from "./AIUsageWidget";
import ChatSearchModal from "./ChatSearchModal";

const SIDEBAR_WIDTH = 259;

export interface ConversationSidebarProps {
  conversations: ConversationSummary[];
  activeConversationId: string;
  onSelect: (id: string) => void;
  onNewChat: () => void;
  onDelete?: (id: string) => void;
  loading?: boolean;
  collapsed?: boolean;
}

export default function ConversationSidebar({
  conversations,
  activeConversationId,
  onSelect,
  onNewChat,
  onDelete,
  collapsed = false,
}: ConversationSidebarProps) {
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);

  return (
    <Flex
      direction="column"
      flexShrink="0"
      style={{
        width: collapsed ? 0 : SIDEBAR_WIDTH,
        borderRight: collapsed ? "none" : "1px solid var(--gray-a6)",
        background: "var(--color-panel-solid)",
        overflow: "hidden",
        transition: "width 220ms ease",
      }}
    >
      {searchOpen && (
        <ChatSearchModal
          conversations={conversations}
          onSelect={onSelect}
          onClose={() => setSearchOpen(false)}
        />
      )}

      {confirmDeleteId && onDelete && (
        <Modal
          trackingEventModalType=""
          header="Delete conversation"
          close={() => setConfirmDeleteId(null)}
          open={true}
          cta="Delete"
          submitColor="danger"
          submit={async () => {
            onDelete(confirmDeleteId);
            setConfirmDeleteId(null);
          }}
          increasedElevation={true}
        >
          <Box px="4">
            <Text as="p" color="text-mid">
              Are you sure you want to delete this conversation? This action
              cannot be undone.
            </Text>
          </Box>
        </Modal>
      )}

      {/* Inner wrapper fades out immediately so contents never look squished */}
      <Flex
        direction="column"
        p="2"
        style={{
          width: SIDEBAR_WIDTH,
          flex: 1,
          minHeight: 0,
          opacity: collapsed ? 0 : 1,
          transition: collapsed
            ? "opacity 60ms ease"
            : "opacity 120ms ease 100ms",
          pointerEvents: collapsed ? "none" : undefined,
        }}
      >
        <Flex direction="column" gap="2">
          <Button onClick={onNewChat}>
            <Flex align="center" justify="center" gap="1">
              <PiPlus size={13} />
              <Text size="medium" weight="medium">
                New chat
              </Text>
            </Flex>
          </Button>

          <Button
            variant="soft"
            onClick={() => {
              track("AI Chat Search");
              setSearchOpen(true);
            }}
          >
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

          <Flex
            direction="column"
            gap="2"
            py="1"
            px="1"
            style={{ paddingRight: 12 }}
          >
            {conversations.length === 0 ? (
              <Flex
                align="center"
                justify="center"
                direction="column"
                gap="2"
                py="5"
                px="3"
              >
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
                return (
                  <button
                    key={conv.conversationId}
                    type="button"
                    className={`${aiChatPrimitives.conversationItem} ${isActive ? aiChatPrimitives.conversationItemActive : ""}`}
                    style={{
                      display: "flex",
                      flexDirection: "row",
                      alignItems: "flex-start",
                      width: "100%",
                      padding: "7px 10px",
                      borderRadius: "var(--radius-2)",
                      border: "1px solid transparent",
                      cursor: "pointer",
                      textAlign: "left",
                    }}
                    onClick={() => onSelect(conv.conversationId)}
                  >
                    <Flex
                      direction="column"
                      gap="1"
                      style={{ flex: 1, minWidth: 0 }}
                    >
                      <Text
                        size="small"
                        weight="semibold"
                        color={isActive ? undefined : "text-high"}
                      >
                        {conv.title || "Untitled"}
                      </Text>
                      {conv.preview ? (
                        <span
                          style={{
                            fontSize: 11,
                            color: isActive
                              ? "rgba(255,255,255,0.75)"
                              : "var(--gray-a11)",
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
                      <Flex
                        asChild
                        align="center"
                        gap="1"
                        style={{
                          fontSize: 11,
                          color: isActive
                            ? "rgba(255,255,255,0.6)"
                            : "var(--gray-a10)",
                        }}
                      >
                        <span>
                          {conv.isStreaming ? (
                            <span
                              title="Streaming"
                              className={aiChatPrimitives.streamingDot}
                            />
                          ) : null}
                          {formatShortAgo(conv.createdAt)}
                        </span>
                      </Flex>
                    </Flex>
                    {onDelete ? (
                      <Box
                        flexShrink="0"
                        ml="1"
                        className={`${aiChatPrimitives.deleteButton} ${aiChatPrimitives.conversationDeleteBtn}`}
                      >
                        <Button
                          variant="ghost"
                          size="xs"
                          title="Delete conversation"
                          stopPropagation
                          onClick={() =>
                            setConfirmDeleteId(conv.conversationId)
                          }
                        >
                          <PiTrash size={13} />
                        </Button>
                      </Box>
                    ) : null}
                  </button>
                );
              })
            )}
          </Flex>
        </ScrollArea>
        <AIUsageWidget />
      </Flex>
    </Flex>
  );
}
