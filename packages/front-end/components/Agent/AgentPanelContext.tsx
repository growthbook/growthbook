import React, {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
} from "react";
import { useUser } from "@/services/UserContext";
import { useAISettings } from "@/hooks/useOrgSettings";
import useMediaQuery from "@/hooks/useMediaQuery";
import { useIsomorphicLayoutEffect } from "@/hooks/useIsomorphicLayoutEffect";
import { useNewAppShell } from "@/components/Layout/newAppShellContext";
import { AGENT_PANEL_OVERLAY_QUERY } from "@/components/Layout/constants";
import track from "@/services/track";

/**
 * The new shell's panel. "opening": open, for the one commit before its DOM
 * mounts, so html.agent-dock-motion lands before the panel's forced read.
 * "closing": its slide out (AGENT_DOCK_MOTION_MS) after open goes false. The
 * panel has DOM in "open" and "closing", and none in "opening". The old
 * shell's panel only ever sees "closed" and "opening".
 */
type AgentPanelPresence = "closed" | "opening" | "open" | "closing";

interface AgentPanelContextValue {
  /** Whether the agent UI should be available to the current user/org. */
  available: boolean;
  open: boolean;
  expanded: boolean;
  presence: AgentPanelPresence;
  /**
   * The new shell, and the window is wide enough for the panel to sit beside
   * the page rather than over it. Always false in the old shell.
   */
  docked: boolean;
  openPanel: () => void;
  closePanel: () => void;
  togglePanel: () => void;
  toggleExpanded: () => void;
}

const AgentPanelContext = createContext<AgentPanelContextValue | null>(null);

/**
 * Above the header (1010) and its notices (1015), below the command palette
 * and modals (1050 and up), which open over it.
 */
export const AGENT_PANEL_Z_INDEX = 1020;
// The panel's slide, as --agent-dock-duration (global.scss).
export const AGENT_DOCK_MOTION_MS = 220;
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

  // Everything below is the new shell's, and does nothing in the old one: no
  // state change, no timer, no write to <html>.
  const newShell = useNewAppShell() === true;
  const overlay = useMediaQuery(
    newShell ? AGENT_PANEL_OVERLAY_QUERY : "not all",
  );
  const docked = newShell && available && !overlay;
  const [rendered, setRendered] = useState(false);
  useIsomorphicLayoutEffect(() => {
    if (!newShell) return;
    if (open) {
      setRendered(true);
      return;
    }
    const timer = window.setTimeout(
      () => setRendered(false),
      AGENT_DOCK_MOTION_MS,
    );
    return () => window.clearTimeout(timer);
  }, [newShell, open]);
  const presence: AgentPanelPresence = rendered
    ? open
      ? "open"
      : "closing"
    : open
      ? "opening"
      : "closed";
  // On for the whole slide in and out, so what moves on its own timing (the
  // side nav, the page) follows the panel's. Written here, not by the panel,
  // which remounts on entering or leaving Settings.
  const dockMotion = docked && presence !== "closed";
  useIsomorphicLayoutEffect(() => {
    if (!dockMotion) return;
    const root = document.documentElement;
    root.classList.add("agent-dock-motion");
    return () => root.classList.remove("agent-dock-motion");
  }, [dockMotion]);

  return (
    <AgentPanelContext.Provider
      value={{
        available,
        open,
        expanded,
        presence,
        docked,
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
