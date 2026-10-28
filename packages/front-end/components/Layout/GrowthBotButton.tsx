import clsx from "clsx";
import { PiRobotBold } from "react-icons/pi";
import Button from "@/ui/Button";
import { useAgentPanel } from "@/components/Agent/AgentPanelContext";
import { useGrowthBotState } from "@/components/Agent/useGrowthBotState";
import styles from "./GrowthBotButton.module.scss";

// Shown on main's rule (AgentPanelContext's `available`: the plan's AI
// suggestions, with AI enabled), and hidden otherwise. At the daily limit
// it still opens the panel, which explains the limit.
export default function GrowthBotButton() {
  const {
    available: agentAvailable,
    open: agentOpen,
    togglePanel: toggleAgentPanel,
  } = useAgentPanel();
  const { state } = useGrowthBotState();

  if (!agentAvailable) return null;

  const limit = state === "limit";
  return (
    <Button
      variant="outline"
      color="gray"
      size="sm"
      className={clsx(styles.fades, agentOpen && styles.panelOpen)}
      // Where focus goes back to as the panel closes (AgentPanel.tsx).
      data-growthbot-trigger
      icon={
        limit ? (
          <span className={styles.iconWrap}>
            <PiRobotBold />
            <span className={styles.limitDot} />
          </span>
        ) : (
          <PiRobotBold />
        )
      }
      onClick={toggleAgentPanel}
      aria-label={
        limit
          ? "AI Assistant, usage limit reached"
          : agentOpen
            ? "Close GrowthBook AI assistant"
            : "Open GrowthBook AI assistant"
      }
      aria-pressed={agentOpen}
    >
      AI Assistant
    </Button>
  );
}
