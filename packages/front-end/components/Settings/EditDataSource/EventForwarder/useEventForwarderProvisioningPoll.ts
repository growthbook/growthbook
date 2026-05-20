import { useEffect, useState } from "react";
import { EventForwarderStatusResponse } from "shared/validators";
import { useAuth } from "@/services/auth";

const POLL_INTERVAL_MS = 5000;
const POLL_TIMEOUT_MS = 10 * 60 * 1000;

type LogLine = { id: string; text: string };

function appendLogLine(lines: LogLine[], text: string): LogLine[] {
  const trimmed = text.trim();
  if (!trimmed) return lines;
  const last = lines[lines.length - 1];
  if (last?.text === trimmed) return lines;
  return [...lines, { id: `${Date.now()}-${lines.length}`, text: trimmed }];
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
  const [errorLogLines, setErrorLogLines] = useState<LogLine[]>([]);
  const [pollTimedOut, setPollTimedOut] = useState(false);
  const isPending = status === "pending";
  const isError = status === "error" || pollTimedOut;

  useEffect(() => {
    if (!isPending) {
      return;
    }

    setPollTimedOut(false);
    const startTime = Date.now();

    const poll = async () => {
      try {
        const result = await apiCall<{
          status: number;
          phase: EventForwarderStatusResponse["phase"];
          message?: string;
        }>(`/datasource/${datasourceId}/event-forwarder/status`);
        if (result.phase === "error" && result.message) {
          setErrorLogLines((lines) => appendLogLine(lines, result.message!));
        }
        await onRefresh();
      } catch (e) {
        const message =
          e instanceof Error ? e.message : "Failed to check connector status";
        setErrorLogLines((lines) => appendLogLine(lines, message));
      }
    };

    void poll();
    const intervalId = window.setInterval(() => {
      if (Date.now() - startTime > POLL_TIMEOUT_MS) {
        setPollTimedOut(true);
        setErrorLogLines((lines) =>
          appendLogLine(
            lines,
            "Provisioning timed out. Try editing the Event Forwarder to retry.",
          ),
        );
        window.clearInterval(intervalId);
        return;
      }
      void poll();
    }, POLL_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [apiCall, datasourceId, isPending, onRefresh]);

  useEffect(() => {
    if (status === "pending") {
      setErrorLogLines([]);
      setPollTimedOut(false);
    }
  }, [status]);

  return {
    isProvisioning: isPending && !pollTimedOut,
    isError,
    errorLogLines,
    pollTimedOut,
  };
}
