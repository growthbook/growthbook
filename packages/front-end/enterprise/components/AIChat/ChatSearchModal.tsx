import React, { useState, useMemo, useRef, useEffect } from "react";
import { Flex, ScrollArea } from "@radix-ui/themes";
import { PiMagnifyingGlass, PiX } from "react-icons/pi";
import { formatShortAgo } from "shared/dates";
import Text from "@/ui/Text";
import Modal from "@/components/Modal";
import type { ConversationSummary } from "@/enterprise/hooks/useAIChat";
import aiChatPrimitives from "./AIChatPrimitives.module.scss";

function highlightMatch(text: string, query: string): React.ReactNode {
  if (!query) return text;
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const idx = lowerText.indexOf(lowerQuery);
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <span style={{ background: "var(--yellow-a5)", borderRadius: 2 }}>
        {text.slice(idx, idx + query.length)}
      </span>
      {text.slice(idx + query.length)}
    </>
  );
}

function SearchResult({
  conversation,
  query,
  onSelect,
}: {
  conversation: ConversationSummary;
  query: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className={aiChatPrimitives.searchResultItem}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 4,
        width: "100%",
        padding: "8px 10px",
        borderRadius: "var(--radius-2)",
        border: "none",
        cursor: "pointer",
        textAlign: "left",
      }}
      onClick={onSelect}
    >
      <Text size="small" weight="semibold" color="text-high">
        {highlightMatch(conversation.title || "Untitled", query)}
      </Text>
      {conversation.preview && (
        <span
          style={{
            fontSize: 12,
            color: "var(--gray-a11)",
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
            lineHeight: 1.4,
            wordBreak: "break-word",
          }}
        >
          {highlightMatch(conversation.preview, query)}
        </span>
      )}
      <span style={{ fontSize: 11, color: "var(--gray-a10)" }}>
        {formatShortAgo(conversation.createdAt)}
      </span>
    </button>
  );
}

interface ChatSearchModalProps {
  conversations: ConversationSummary[];
  onSelect: (id: string) => void;
  onClose: () => void;
}

export default function ChatSearchModal({
  conversations,
  onSelect,
  onClose,
}: ChatSearchModalProps) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const timer = setTimeout(() => inputRef.current?.focus(), 60);
    return () => clearTimeout(timer);
  }, []);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return conversations.filter((c) => {
      const title = (c.title || "").toLowerCase();
      const preview = (c.preview || "").toLowerCase();
      return title.includes(q) || preview.includes(q);
    });
  }, [query, conversations]);

  const hasQuery = query.trim().length > 0;

  return (
    <Modal
      trackingEventModalType=""
      header="Search chats"
      close={onClose}
      open={true}
      increasedElevation={true}
      size="md"
      autoCloseOnSubmit={false}
    >
      <Flex direction="column" gap="3" px="4" pb="3">
        <Flex
          align="center"
          gap="2"
          style={{
            border: "1px solid var(--gray-a6)",
            borderRadius: "var(--radius-2)",
            padding: "6px 10px",
            background: "var(--color-surface)",
          }}
        >
          <PiMagnifyingGlass size={16} color="var(--gray-a9)" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search your chats..."
            style={{
              flex: 1,
              border: "none",
              outline: "none",
              background: "transparent",
              fontSize: 14,
              color: "var(--gray-12)",
              fontFamily: "inherit",
            }}
          />
          {hasQuery && (
            <button
              type="button"
              onClick={() => setQuery("")}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: 2,
                display: "flex",
                color: "var(--gray-a9)",
              }}
            >
              <PiX size={14} />
            </button>
          )}
        </Flex>

        <ScrollArea
          type="hover"
          scrollbars="vertical"
          style={{ maxHeight: 360, minHeight: 120 }}
        >
          {!hasQuery ? (
            <Flex
              align="center"
              justify="center"
              direction="column"
              gap="2"
              py="6"
            >
              <PiMagnifyingGlass size={24} color="var(--violet-a11)" />
              <Text size="medium" weight="semibold" color="text-high">
                Search your chat history
              </Text>
              <Text size="small" color="text-low">
                Type to find past conversations
              </Text>
            </Flex>
          ) : results.length === 0 ? (
            <Flex
              align="center"
              justify="center"
              direction="column"
              gap="2"
              py="6"
            >
              <Text size="medium" weight="semibold" color="text-high">
                No results
              </Text>
              <Text size="small" color="text-low">
                Try a different search term
              </Text>
            </Flex>
          ) : (
            <Flex direction="column" gap="1">
              {results.map((conv) => (
                <SearchResult
                  key={conv.conversationId}
                  conversation={conv}
                  query={query.trim()}
                  onSelect={() => {
                    onSelect(conv.conversationId);
                    onClose();
                  }}
                />
              ))}
            </Flex>
          )}
        </ScrollArea>
      </Flex>
    </Modal>
  );
}
