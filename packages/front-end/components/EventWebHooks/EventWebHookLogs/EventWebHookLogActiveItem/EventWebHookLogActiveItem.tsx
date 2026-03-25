import React, { FC } from "react";
import { EventWebHookLogInterface } from "shared/types/event-webhook-log";
import { datetime } from "shared/dates";
import { useIconForState } from "@/components/EventWebHooks/utils";
import Code from "@/components/SyntaxHighlighting/Code";

type EventWebHookLogActiveItemProps = {
  log: EventWebHookLogInterface;
};

export const EventWebHookLogActiveItem: FC<EventWebHookLogActiveItemProps> = ({
  log,
}) => {
  const iconForState = useIconForState(log.result, { text: true });

  return (
    <div>
      <div className="d-flex align-items-center">
        <h4 className="mb-0">
          {log.event ?? <span className="font-italic">unknown</span>}
        </h4>
        <span className="d-inline-block ml-2 pt-1">{iconForState}</span>
        <span className="ml-auto mr-2">{datetime(log.dateCreated)}</span>
      </div>

      {log.url && (
        <>
          <div className="mt-4 mb-3 d-flex align-items-center">
            <h4 className="mb-0">Request URL</h4>
            {log.method && (
              <span className="p-1 px-2 mb-0 rounded-pill badge badge-light d-flex align-items-center">
                <span className="ml-1 mb-0 text-muted font-weight-normal">
                  {log.method}
                </span>
              </span>
            )}
          </div>
          <p className="text-muted">{log.url}</p>
        </>
      )}

      <h4 className="mt-4 mb-3">Request Payload</h4>
      <Code
        expandable={true}
        code={JSON.stringify(log.payload, null, 2)}
        language="json"
      />

      <h4 className="mt-4">Response Code</h4>
      <p>{log.responseCode || "None"}</p>

      <h4 className="mt-4">Response Body</h4>
      <code className="text-main">{log.responseBody}</code>
    </div>
  );
};
