import React, {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
} from "react";
import { useUser } from "@/services/UserContext";
import { useAISettings } from "@/hooks/useOrgSettings";
import track from "@/services/track";

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
 * at the app shell) stay in sync. State lives in plain React state: it
 * survives in-tab client-side navigation (the provider is mounted in
 * _app.tsx, which is not remounted on route changes) but intentionally
 * resets on a full page reload, so a refresh always starts with the panel
 * closed.
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
  // Mirror for open/close handlers so tracking stays outside setState updaters.
  const openRef = useRef(open);
  openRef.current = open;

  const openPanel = useCallback(() => {
    if (!openRef.current) {
      track("AI Assistant Panel Opened");
    }
    setOpen(true);
  }, []);

  const closePanel = useCallback(() => {
    if (openRef.current) {
      track("AI Assistant Panel Closed");
    }
    setOpen(false);
  }, []);

  const togglePanel = useCallback(() => {
    track(
      openRef.current
        ? "AI Assistant Panel Closed"
        : "AI Assistant Panel Opened",
    );
    setOpen((prev) => !prev);
  }, []);

  const toggleExpanded = useCallback(() => {
    setExpanded((prev) => !prev);
  }, []);

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
