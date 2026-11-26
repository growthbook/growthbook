import { useEffect, useRef } from "react";
import DashboardBuilderRail from "./DashboardBuilderRail";
import { useDashboardBuilderChat } from "./useDashboardBuilderChat";

export const ASSISTANT_RAIL_WIDTH = 380;

// The builder's AI Assistant, docked to the right of a saved dashboard; it edits the draft.
export default function DashboardAssistantRail({
  dashboardId,
  dashboardTitle,
  message,
  onDraftChange,
  onClose,
}: {
  dashboardId: string;
  dashboardTitle: string;
  // Sent as soon as it is set, e.g. a comment thread passed over with Send to AI.
  message: { text: string } | null;
  onDraftChange: () => void;
  onClose: () => void;
}) {
  const { rail, send } = useDashboardBuilderChat(dashboardId, onDraftChange);
  // send changes identity between renders; each message goes out once.
  const sent = useRef<typeof message>(null);
  useEffect(() => {
    if (!message || sent.current === message) return;
    sent.current = message;
    send(message.text);
  }, [message, send]);
  return (
    <div
      style={{
        position: "fixed",
        top: "var(--page-top-offset)",
        right: 0,
        bottom: 0,
        display: "flex",
        zIndex: 10,
      }}
    >
      <DashboardBuilderRail
        {...rail}
        dashboardTitle={dashboardTitle}
        onClose={onClose}
      />
    </div>
  );
}
