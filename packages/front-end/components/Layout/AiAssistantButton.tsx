import clsx from "clsx";
import { PiSparkleBold } from "react-icons/pi";
import Button from "@/ui/Button";
import { useAgentPanel } from "@/components/Agent/AgentPanelContext";
import styles from "./AiAssistantButton.module.scss";

export default function AiAssistantButton({
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
    <span className={clsx(styles.wrapper, className)}>
      <Button
        variant="ghost"
        color="gray"
        size="sm"
        className={clsx(styles.fades, agentOpen && styles.panelOpen)}
        // Where focus goes back to as the panel closes (AgentPanel.tsx).
        data-ai-assistant-trigger
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
