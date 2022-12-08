import React, { FC, useCallback, useEffect, useMemo, useState } from "react";
import { EventWebHookLogInterface } from "back-end/types/event-webhook-log";
import useApi from "../../../hooks/useApi";
import { useRouter } from "next/router";
import { EventWebHookLogItem } from "./EventWebHookLogItem/EventWebHookLogItem";

type EventWebHookLogsProps = {
  onLogItemClicked: (logId: string) => void;
  activeLog: EventWebHookLogInterface;
  logs: EventWebHookLogInterface[];
};

export const EventWebHookLogs: FC<EventWebHookLogsProps> = ({
  logs,
  activeLog,
  onLogItemClicked,
}) => {
  return (
    <div>
      <h2>Run Logs</h2>

      <div className="row">
        <div className="col-xs-12 col-md-6">
          <table className="table appbox gbtable table-hover">
            <thead>
              <tr>
                <th>Status</th>
                <th>Event</th>
                <th>Timestamp</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <EventWebHookLogItem
                  key={log.id}
                  log={log}
                  onClick={onLogItemClicked}
                  activeLogId={activeLog?.id || null}
                />
              ))}
            </tbody>
          </table>
        </div>
        <div className="col-xs-12 col-md-6">
          <pre>{JSON.stringify(activeLog, null, 2)}</pre>
        </div>
      </div>
    </div>
  );
};

export const EventWebHookLogsContainer = () => {
  const router = useRouter();
  const { eventwebhookid: eventWebHookId } = router.query;
  const { data, error } = useApi<{
    eventWebHookLogs: EventWebHookLogInterface[];
  }>(`/event-webhooks/logs/${eventWebHookId}`);

  const [activeLog, setActiveLog] = useState<EventWebHookLogInterface | null>(
    null
  );

  const logLookup: Map<string, EventWebHookLogInterface> = useMemo(() => {
    return (data?.eventWebHookLogs || []).reduce<
      Map<string, EventWebHookLogInterface>
    >((all, curr) => {
      all.set(curr.id, curr);
      return all;
    }, new Map());
  }, [data]);

  const handleLogItemClick = useCallback(
    (logId: string) => {
      const logToHighlight = logLookup.get(logId) || null;
      setActiveLog(logToHighlight);
    },
    [logLookup]
  );

  useEffect(
    function setDefaultActiveLog() {
      if (!data) {
        setActiveLog(null);
        return;
      }

      setActiveLog(data.eventWebHookLogs[0] || null);
    },
    [data]
  );

  if (error) {
    return (
      <div className="alert alert-danger">
        Unable to fetch run log history for event web hook {eventWebHookId}
      </div>
    );
  }

  if (!data) {
    return null;
  }

  return (
    <EventWebHookLogs
      logs={data?.eventWebHookLogs || []}
      activeLog={activeLog}
      onLogItemClicked={handleLogItemClick}
    />
  );
};
