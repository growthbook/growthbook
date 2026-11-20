import React from "react";
import PylonChatVisibility from "@/components/Auth/PylonChatVisibility";
import { useUser } from "@/services/UserContext";
import { useNewAppShell } from "@/components/Layout/AppShell";
import AgentPanel from "./AgentPanel";
import { useAgentPanel } from "./AgentPanelContext";
import LegacyAgentPanel from "./legacy/AgentPanel";

/**
 * Site-wide mount point for the generic GrowthBook agent panel. The actual
 * trigger button lives in the TopNav (next to the user account dropdown);
 * this component is just responsible for rendering the slide-in panel
 * itself, driven by the shared `AgentPanelContext` state.
 */
export default function AgentLauncher() {
  const { available, open, expanded, closePanel, toggleExpanded } =
    useAgentPanel();
  const { userId, organization } = useUser();
  const newShell = useNewAppShell();

  if (!available) return null;

  const Panel = newShell ? AgentPanel : LegacyAgentPanel;

  return (
    <>
      <Panel
        // Remount on org or user switch so the chat hook re-reads its scoped key.
        key={`${organization.id}:${userId}`}
        open={open}
        expanded={expanded}
        onClose={closePanel}
        onToggleExpanded={toggleExpanded}
      />
      {/* Keep the live chat widget from overlapping the panel while it's open. */}
      <PylonChatVisibility hidden={open} />
    </>
  );
}
