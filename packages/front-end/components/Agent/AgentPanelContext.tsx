import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { useUser } from "@/services/UserContext";
import { useAISettings } from "@/hooks/useOrgSettings";

const OPEN_KEY = "growthbook.agent.open";
const EXPANDED_KEY = "growthbook.agent.expanded";

interface AgentPanelContextValue {
  /** Whether the agent UI should be available to the current user/org. */
  available: boolean;
  open: boolean;
  expanded: boolean;
  openPanel: () => void;
  closePanel: () => void;
  togglePanel: () => void;
  toggleExpanded: () => void;
}

const AgentPanelContext = createContext<AgentPanelContextValue | null>(null);

/**
 * Holds the open / expanded state for the site-wide agent panel so that
 * the trigger (rendered inside the TopNav) and the panel itself (mounted
 * at the app shell) stay in sync. Both flags are persisted to
 * sessionStorage so the panel survives in-tab navigation and reloads but
 * does NOT leak across tabs — the conversation id itself is also per-tab
 * (see useAIChat), so opening a new tab should give a clean slate.
 */
export function AgentPanelProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { hasCommercialFeature } = useUser();
  const { aiEnabled } = useAISettings();
  const available = hasCommercialFeature("ai-suggestions") && aiEnabled;

  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    try {
      if (sessionStorage.getItem(OPEN_KEY) === "true") setOpen(true);
      if (sessionStorage.getItem(EXPANDED_KEY) === "true") setExpanded(true);
    } catch {
      // ignore
    }
  }, []);

  const persistOpen = useCallback((value: boolean) => {
    try {
      sessionStorage.setItem(OPEN_KEY, value ? "true" : "false");
    } catch {
      // ignore
    }
  }, []);

  const persistExpanded = useCallback((value: boolean) => {
    try {
      sessionStorage.setItem(EXPANDED_KEY, value ? "true" : "false");
    } catch {
      // ignore
    }
  }, []);

  const openPanel = useCallback(() => {
    setOpen(true);
    persistOpen(true);
  }, [persistOpen]);

  const closePanel = useCallback(() => {
    setOpen(false);
    persistOpen(false);
  }, [persistOpen]);

  const togglePanel = useCallback(() => {
    setOpen((prev) => {
      const next = !prev;
      persistOpen(next);
      return next;
    });
  }, [persistOpen]);

  const toggleExpanded = useCallback(() => {
    setExpanded((prev) => {
      const next = !prev;
      persistExpanded(next);
      return next;
    });
  }, [persistExpanded]);

  return (
    <AgentPanelContext.Provider
      value={{
        available,
        open,
        expanded,
        openPanel,
        closePanel,
        togglePanel,
        toggleExpanded,
      }}
    >
      {children}
    </AgentPanelContext.Provider>
  );
}

export function useAgentPanel(): AgentPanelContextValue {
  const ctx = useContext(AgentPanelContext);
  if (!ctx) {
    throw new Error("useAgentPanel must be used within an AgentPanelProvider");
  }
  return ctx;
}
