import React from "react";
import PylonChatVisibility from "@/components/Auth/PylonChatVisibility";
import AgentPanel from "./AgentPanel";
import { useAgentPanel } from "./AgentPanelContext";

/**
 * Site-wide mount point for the generic GrowthBook agent panel. The actual
 * trigger button lives in the TopNav (next to the user account dropdown);
 * this component is just responsible for rendering the slide-in panel
 * itself, driven by the shared `AgentPanelContext` state.
 */
export default function AgentLauncher() {
  const { available, open, expanded, closePanel, toggleExpanded } =
    useAgentPanel();

  if (!available) return null;

  return (
    <>
      <AgentPanel
        open={open}
        expanded={expanded}
        onClose={closePanel}
        onToggleExpanded={toggleExpanded}
      />
      {/* Keep the live chat widget from overlapping the panel while it's open. */}
      <PylonChatVisibility />
    </>
  );
}
