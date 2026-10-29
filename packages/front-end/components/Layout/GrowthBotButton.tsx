import { PiSparkleBold } from "react-icons/pi";
import Button from "@/ui/Button";
import { useAgentPanel } from "@/components/Agent/AgentPanelContext";

// Shown on main's rule (AgentPanelContext's `available`: the plan's AI
// suggestions, with AI enabled), and hidden otherwise. As main's, it has
// no limit indicator: at the daily limit the panel explains it.
export default function GrowthBotButton() {
  const {
    available: agentAvailable,
    open: agentOpen,
    togglePanel: toggleAgentPanel,
  } = useAgentPanel();

  if (!agentAvailable) return null;

  return (
    <Button
      variant="outline"
      color="gray"
      size="sm"
      icon={<PiSparkleBold />}
      onClick={toggleAgentPanel}
      aria-label={
        agentOpen
          ? "Close GrowthBook AI assistant"
          : "Open GrowthBook AI assistant"
      }
      aria-pressed={agentOpen}
    >
      AI Assistant
    </Button>
  );
}
