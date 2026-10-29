import { PiSparkleBold } from "react-icons/pi";
import Button from "@/ui/Button";
import { useAgentPanel } from "@/components/Agent/AgentPanelContext";

export default function GrowthBotButton({
  className,
}: {
  /**
   * Applied to a wrapper, for the header's optical alignment
   * (TopNav.module.scss).
   */
  className?: string;
}) {
  const {
    available: agentAvailable,
    open: agentOpen,
    togglePanel: toggleAgentPanel,
  } = useAgentPanel();

  if (!agentAvailable) return null;

  return (
    <span className={className}>
      <Button
        variant="ghost"
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
    </span>
  );
}
