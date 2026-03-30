import React from "react";
import { Flex } from "@radix-ui/themes";
import { PiPlus } from "react-icons/pi";
import Button from "@/ui/Button";
import Text from "@/ui/Text";
import type { ConversationSummary } from "@/enterprise/hooks/useAIChat";
import styles from "./ConversationSidebar.module.scss";

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
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ConversationSidebar({
  conversations,
  activeConversationId,
  onSelect,
  onNewChat,
}: ConversationSidebarProps) {
  return (
    <div className={styles.sidebar}>
      <Flex
        align="center"
        justify="between"
        className={styles.sidebarHeader}
      >
        <Text size="small" weight="medium" color="text-mid">
          Chats
        </Text>
        <Button variant="ghost" size="xs" onClick={onNewChat} title="New chat">
          <PiPlus size={13} />
        </Button>
      </Flex>

      <div className={styles.list}>
        {conversations.length === 0 ? (
          <div className={styles.empty}>No conversations yet</div>
        ) : (
          conversations.map((conv) => (
            <button
              key={conv.conversationId}
              className={`${styles.item} ${
                conv.conversationId === activeConversationId
                  ? styles.active
                  : ""
              }`}
              onClick={() => onSelect(conv.conversationId)}
            >
              <span className={styles.itemTitle}>
                {conv.title || "Untitled"}
              </span>
              <span className={styles.itemMeta}>
                {conv.isStreaming && (
                  <span className={styles.streamingDot} title="Streaming" />
                )}
                {relativeTime(conv.createdAt)}
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
