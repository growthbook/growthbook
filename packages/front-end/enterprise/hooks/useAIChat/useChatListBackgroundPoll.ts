import { useEffect, useMemo } from "react";
import type { ConversationSummary } from "./types";
import { REMOTE_STREAM_POLL_INTERVAL_MS } from "./remoteStreamConstants";

/**
 * Revalidates the conversation list on an interval while at least one
 * conversation other than the active one is streaming, so sidebar dots stay
 * accurate when the user is viewing a different chat.
 */
export function useChatListBackgroundPoll(
  conversations: ConversationSummary[] | undefined,
  activeConversationId: string,
  refreshList: () => unknown,
): void {
  const hasBackgroundStreaming = useMemo(
    () =>
      (conversations ?? []).some(
        (c) => c.isStreaming && c.conversationId !== activeConversationId,
      ),
    [conversations, activeConversationId],
  );

  useEffect(() => {
    if (!hasBackgroundStreaming) return;
    const t = setInterval(() => {
      void refreshList();
    }, REMOTE_STREAM_POLL_INTERVAL_MS);
    return () => clearInterval(t);
  }, [hasBackgroundStreaming, refreshList]);
}
