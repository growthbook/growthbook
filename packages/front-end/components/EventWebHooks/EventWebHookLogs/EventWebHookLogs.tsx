import React, { FC, useCallback, useEffect, useMemo, useState } from "react";
import _ from "lodash";
import { EventWebHookLogInterface } from "back-end/types/event-webhook-log";
import { useRouter } from "next/router";
import { useEventWebhookLogs } from "@/hooks/useEventWebhookLogs";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableColumnHeader,
} from "@/ui/Table";
import { EventWebHookLogItem } from "./EventWebHookLogItem/EventWebHookLogItem";
import { EventWebHookLogActiveItem } from "./EventWebHookLogActiveItem/EventWebHookLogActiveItem";

type EventWebHookLogsProps = {
  onLogItemClicked: (logId: string) => void;
  activeLog: EventWebHookLogInterface | null;
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

      {logs.length === 0 ? (
        <div>
          <p>Run Logs will show up here</p>
        </div>
      ) : (
        <div className="row">
          <div className="col-xs-12 col-md-6">
            <Table variant="standard" hover className="appbox">
              <TableHeader>
                <TableRow>
                  <TableColumnHeader className="text-left">Timestamp</TableColumnHeader>
                  <TableColumnHeader className="text-left">Event</TableColumnHeader>
                  <TableColumnHeader className="text=left">Result</TableColumnHeader>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.map((log) => (
                  <EventWebHookLogItem
                    key={log.id}
                    log={log}
                    onClick={onLogItemClicked}
                    activeLogId={activeLog?.id || null}
                  />
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="col-xs-12 col-md-6">
            {activeLog ? (
              <EventWebHookLogActiveItem log={activeLog} />
            ) : (
              <p>Highlight a log to view the details</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export const EventWebHookLogsContainer = () => {
  const router = useRouter();
  const { eventwebhookid: eventWebHookId } = router.query;
  const { data, error } = useEventWebhookLogs(`${eventWebHookId}`);

  const [activeLog, setActiveLog] = useState<EventWebHookLogInterface | null>(
    null,
  );

  const logLookup: Record<string, EventWebHookLogInterface> = useMemo(() => {
    return _.keyBy(data?.eventWebHookLogs || [], "id");
  }, [data]);

  const handleLogItemClick = useCallback(
    (logId: string) => {
      const logToHighlight = logLookup[logId] || null;
      setActiveLog(logToHighlight);
    },
    [logLookup],
  );

  useEffect(
    function setDefaultActiveLog() {
      if (!data) {
        setActiveLog(null);
        return;
      }

      setActiveLog(data.eventWebHookLogs[0] || null);
    },
    [data],
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
