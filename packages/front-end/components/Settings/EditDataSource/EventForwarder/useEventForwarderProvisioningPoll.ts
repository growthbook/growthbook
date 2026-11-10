import { useCallback, useEffect, useRef, useState } from "react";
import { EventForwarderStatusResponse } from "shared/validators";
import { useAuth } from "@/services/auth";

const POLL_INTERVAL_MS = 5000;
const POLL_TIMEOUT_MS = 10 * 60 * 1000;
const BACKLOG_POLL_INTERVAL_MS = 15000;

export const PROVISIONING_TIMEOUT_MESSAGE =
  "Provisioning timed out. Try editing the Event Forwarder to retry.";

type StatusPollResult = EventForwarderStatusResponse;

function isTerminalErrorStatus(status: string | undefined): boolean {
  return status === "error" || status === "schema_update_error";
}

export function useEventForwarderProvisioningPoll({
  datasourceId,
  status,
  onRefresh,
}: {
  datasourceId: string;
  status: string | undefined;
  onRefresh: () => Promise<void>;
}) {
  const { apiCall } = useAuth();
  const [pollTimedOut, setPollTimedOut] = useState(false);
  const [taskErrors, setTaskErrors] =
    useState<EventForwarderStatusResponse["taskErrors"]>();
  const [backlog, setBacklog] =
    useState<EventForwarderStatusResponse["backlog"]>();
  const refreshedStatusRef = useRef<string | null>(null);
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;
  const isPending = status === "pending";
  const isError = isTerminalErrorStatus(status) || pollTimedOut;

  const fetchConnectorStatus = useCallback(async () => {
    const result = await apiCall<StatusPollResult>(
      `/datasource/${datasourceId}/event-forwarder/status`,
    );
    if (result.taskErrors?.length) {
      setTaskErrors(result.taskErrors);
    }
    setBacklog(result.backlog?.count ? result.backlog : undefined);
    await onRefreshRef.current();
  }, [apiCall, datasourceId]);

  useEffect(() => {
    if (!isPending) {
      return;
    }

    setPollTimedOut(false);

    const startTime = Date.now();

    const poll = async () => {
      try {
        await fetchConnectorStatus();
      } catch {
        // Keep polling; terminal errors surface via persisted status.
      }
    };

    void poll();
    const intervalId = window.setInterval(() => {
      if (Date.now() - startTime > POLL_TIMEOUT_MS) {
        setPollTimedOut(true);
        window.clearInterval(intervalId);
        return;
      }
      void poll();
    }, POLL_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [fetchConnectorStatus, isPending]);

  // Once per settled status: a ready forwarder can still have failed writes
  // that only the status sync records.
  useEffect(() => {
    if (status !== "ready" && !isTerminalErrorStatus(status)) {
      return;
    }

    const refreshKey = `${datasourceId}:${status}`;
    if (refreshedStatusRef.current === refreshKey) {
      return;
    }
    refreshedStatusRef.current = refreshKey;

    void fetchConnectorStatus().catch(() => {
      // Persisted status remains the source of truth for display.
    });
  }, [datasourceId, fetchConnectorStatus, status]);

  // A replay shrinks the backlog while the forwarder is ready; keep the count current.
  const hasBacklog = !!backlog;
  useEffect(() => {
    if (status !== "ready" || !hasBacklog) {
      return;
    }
    const intervalId = window.setInterval(() => {
      void fetchConnectorStatus().catch(() => {
        // The next tick retries.
      });
    }, BACKLOG_POLL_INTERVAL_MS);
    return () => {
      window.clearInterval(intervalId);
    };
  }, [fetchConnectorStatus, hasBacklog, status]);

  useEffect(() => {
    if (status === "pending") {
      setPollTimedOut(false);
      setTaskErrors(undefined);
      refreshedStatusRef.current = null;
    }
  }, [status]);

  return {
    isProvisioning: isPending && !pollTimedOut,
    isError,
    pollTimedOut,
    taskErrors,
    backlog,
  };
}
