import { useState, useMemo, useCallback } from "react";
import useApi from "@/hooks/useApi";
import { useAuth } from "@/services/auth";
import {
  useChatListBackgroundPoll,
  type ConversationSummary,
  AIChatMessage,
} from "@/enterprise/hooks/useAIChat";

const CHAT_LIST_ENDPOINT = "/product-analytics/chat";

export function useConversationList(
  conversationId: string,
  messages: AIChatMessage[],
  loading: boolean,
) {
  const [chatTitles, setChatTitles] = useState<Record<string, string>>({});
  const { apiCall } = useAuth();

  const { data: listData, mutate: refreshList } = useApi<{
    conversations: ConversationSummary[];
  }>(CHAT_LIST_ENDPOINT);

  useChatListBackgroundPoll(
    listData?.conversations,
    conversationId,
    refreshList,
  );

  const conversations = useMemo(() => {
    const list = listData?.conversations ?? [];
    const applyTitleOverrides = (
      items: ConversationSummary[],
    ): ConversationSummary[] => {
      if (!Object.keys(chatTitles).length) return items;
      return items.map((c) => {
        const override = chatTitles[c.conversationId];
        return override ? { ...c, title: override } : c;
      });
    };

    const isInList = list.some((c) => c.conversationId === conversationId);
    if (!isInList && messages.length > 0) {
      const firstUserMsg = messages.find((m) => m.role === "user");
      const preview =
        typeof firstUserMsg?.content === "string" ? firstUserMsg.content : "";
      return [
        {
          conversationId,
          title: chatTitles[conversationId] ?? "New Chat",
          createdAt: Date.now(),
          messageCount: messages.length,
          isStreaming: loading,
          preview,
        },
        ...applyTitleOverrides(list),
      ];
    }
    return applyTitleOverrides(list);
  }, [listData?.conversations, conversationId, messages, loading, chatTitles]);

  const handleTitleUpdate = useCallback(
    (id: string, title: string) => {
      setChatTitles((prev) => ({ ...prev, [id]: title }));
      void refreshList();
    },
    [refreshList],
  );

  const deleteConversation = useCallback(
    async (id: string) => {
      await apiCall(`/product-analytics/chat/${id}`, { method: "DELETE" });
      await refreshList();
    },
    [apiCall, refreshList],
  );

  return {
    conversations,
    rawConversations: listData?.conversations,
    refreshList,
    handleTitleUpdate,
    deleteConversation,
  };
}
