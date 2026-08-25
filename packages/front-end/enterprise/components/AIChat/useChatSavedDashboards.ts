import { useState, useCallback, useRef } from "react";
import type { AIChatSavedDashboard } from "shared/validators";
import { useAuth } from "@/services/auth";

/**
 * Tracks which dashboard each `proposeDashboard` preview has been saved to,
 * keyed by tool call id.
 *
 * Component state alone is not enough: it dies with the mount, so re-opening a
 * conversation would offer Save again on a tile that already has a dashboard
 * and create a second one. The binding is persisted on the conversation and
 * reloaded with it.
 *
 * Mirrors `useChatFeedback`, including the conversationId ref — the consumer
 * keeps `conversationIdRef.current` in sync after `useAIChat` returns.
 */
export function useChatSavedDashboards(
  endpointBase = "/product-analytics/chat",
) {
  const conversationIdRef = useRef("");
  const [savedDashboardMap, setSavedDashboardMap] = useState<
    Record<string, string>
  >({});
  const { apiCall } = useAuth();

  const handleDashboardSaved = useCallback(
    (toolCallId: string, dashboardId: string) => {
      setSavedDashboardMap((prev) => ({ ...prev, [toolCallId]: dashboardId }));

      void apiCall(
        `${endpointBase}/${conversationIdRef.current}/saved-dashboard`,
        {
          method: "POST",
          body: JSON.stringify({ toolCallId, dashboardId }),
        },
      );
    },
    [apiCall, endpointBase],
  );

  const loadSavedDashboardsFromConversation = useCallback((data: unknown) => {
    const entries = (data as { savedDashboards?: AIChatSavedDashboard[] })
      .savedDashboards;
    if (!entries?.length) {
      setSavedDashboardMap({});
      return;
    }
    setSavedDashboardMap(
      Object.fromEntries(entries.map((e) => [e.toolCallId, e.dashboardId])),
    );
  }, []);

  const clearSavedDashboards = useCallback(() => setSavedDashboardMap({}), []);

  return {
    savedDashboardMap,
    handleDashboardSaved,
    loadSavedDashboardsFromConversation,
    clearSavedDashboards,
    conversationIdRef,
  };
}
