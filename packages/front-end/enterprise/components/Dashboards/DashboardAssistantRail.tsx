import { useEffect } from "react";
import DashboardBuilderRail from "./DashboardBuilderRail";
import { useDashboardBuilderChat } from "./useDashboardBuilderChat";

export const ASSISTANT_RAIL_WIDTH = 380;

// The builder's AI Assistant, docked to the right of a saved dashboard; it edits the draft.
export default function DashboardAssistantRail({
  dashboardId,
  dashboardTitle,
  message,
  onMessageSent,
  onDraftChange,
  onClose,
}: {
  dashboardId: string;
  dashboardTitle: string;
  // Sent as soon as it is set, e.g. a comment thread passed over with Send to AI.
  message: { text: string } | null;
  onMessageSent: () => void;
  onDraftChange: () => void;
  onClose: () => void;
}) {
  const { rail, send, loading } = useDashboardBuilderChat(
    dashboardId,
    onDraftChange,
  );
  // Waits for a reply in progress, and hands the message back so a reopen cannot resend it.
  useEffect(() => {
    if (!message || loading) return;
    send(message.text);
    onMessageSent();
  }, [message, loading, send, onMessageSent]);
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
