import { useCallback, useEffect, useRef, useState } from "react";
import { PiArrowSquareOut } from "react-icons/pi";
import {
  DashboardBlockInterfaceOrData,
  DashboardInterface,
  SqlExplorationBlockInterface,
} from "shared/enterprise";
import Button from "@/ui/Button";
import Tooltip from "@/components/Tooltip/Tooltip";
import {
  createDashboardSqlBlockEditSession,
  getDashboardSqlBlockEditChannelName,
  parseDashboardSqlBlockEditMessage,
  removeDashboardSqlBlockEditSession,
} from "@/enterprise/components/Dashboards/dashboardSqlBlockEditSession";

export default function SqlExplorationExternalEditor({
  block,
  dashboardGlobalControls,
  onUpdate,
  onExit,
}: {
  block: DashboardBlockInterfaceOrData<SqlExplorationBlockInterface>;
  dashboardGlobalControls?: DashboardInterface["globalControls"];
  onUpdate: (
    block: DashboardBlockInterfaceOrData<SqlExplorationBlockInterface>,
  ) => void;
  onExit: () => void;
}) {
  const channelRef = useRef<BroadcastChannel | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const clearSession = useCallback(() => {
    channelRef.current?.close();
    channelRef.current = null;
    if (sessionIdRef.current) {
      removeDashboardSqlBlockEditSession(sessionIdRef.current);
      sessionIdRef.current = null;
    }
  }, []);

  useEffect(() => clearSession, [clearSession]);

  const openEditor = () => {
    setError(null);
    clearSession();

    if (!window.BroadcastChannel) {
      setError(
        "Your browser does not support editing this block in a new tab.",
      );
      return;
    }

    const sessionId = crypto.randomUUID();
    sessionIdRef.current = sessionId;
    createDashboardSqlBlockEditSession({
      sessionId,
      block,
      dashboardGlobalControls,
    });

    const channel = new BroadcastChannel(
      getDashboardSqlBlockEditChannelName(sessionId),
    );
    channelRef.current = channel;
    channel.onmessage = (event: MessageEvent<unknown>) => {
      const message = parseDashboardSqlBlockEditMessage(event.data, sessionId);
      if (!message) return;

      clearSession();
      if (message.type === "update") {
        onUpdate(message.block);
      } else {
        onExit();
      }
    };

    const editorWindow = window.open(
      `/product-analytics/explore/sql-block?session=${encodeURIComponent(sessionId)}`,
      "_blank",
    );
    if (!editorWindow) {
      clearSession();
      setError(
        "The SQL editor could not be opened. Check your browser's popup settings and try again.",
      );
    }
  };

  return (
    <Tooltip body={error ?? ""} shouldDisplay={Boolean(error)}>
      <Button
        size="sm"
        variant="outline"
        color="violet"
        onClick={openEditor}
        icon={<PiArrowSquareOut />}
      >
        Edit Query
      </Button>
    </Tooltip>
  );
}
