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
import { isPrototypeAI } from "@/services/env";
import { installPrototypeAIStub } from "./prototypeAIStub";
import { MOCK_CONVERSATION_ID } from "./prototypeMockChat";
import {
  syncMockConversationId,
  usePrototypeMockConversation,
} from "./prototypeMockConversation";

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

/** Above the panel. Portaling the panel to body also puts it over its own body portals. */
export const AGENT_PANEL_Z_INDEX = 10001;
export const AGENT_PANEL_PORTAL_Z_INDEX = AGENT_PANEL_Z_INDEX + 1;

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
  const { hasCommercialFeature, organization, userId } = useUser();
  const { aiEnabled } = useAISettings();
  // PROTOTYPE ONLY: with NEXT_PUBLIC_PROTOTYPE_AI=true the drawer is always
  // available, and its requests get canned replies (prototypeAIStub.ts).
  // Off, as before: the plan's ai-suggestions and the org's AI setting.
  const prototypeAI = isPrototypeAI();
  // PROTOTYPE ONLY ("Mock conversation", set in review;
  // prototypeMockConversation.ts): the drawer available too, the same stub
  // answering it, and opening onto the canned conversation.
  const mockChat = usePrototypeMockConversation();
  const available =
    prototypeAI ||
    mockChat ||
    (hasCommercialFeature("ai-suggestions") && aiEnabled);
  // Installed while rendering (once; repeat calls do nothing), so it's in
  // place before the drawer's first requests: effects run child-first, so
  // one here would come after the drawer's.
  if (prototypeAI || mockChat) installPrototypeAIStub();
  syncMockConversationId(
    organization.id,
    userId,
    mockChat,
    MOCK_CONVERSATION_ID,
  );

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
