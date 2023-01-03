import React, { FC } from "react";
import { EventWebHookLogInterface } from "back-end/types/event-webhook-log";
import { NotificationEvent } from "back-end/src/events/base-events";
import { useIconForState } from "../../utils";
import Code from "../../../SyntaxHighlighting/Code";

type EventWebHookLogActiveItemProps = {
  log: EventWebHookLogInterface;
};

export const EventWebHookLogActiveItem: FC<EventWebHookLogActiveItemProps> = ({
  log,
}) => {
  const iconForState = useIconForState(log.result);

  return (
    <div>
      {/* Title with status icon */}
      <h3 className="d-flex align-items-center">
        <span className="d-inline-block mr-1" style={{ fontSize: "1.7rem" }}>
          {iconForState}
        </span>
        {(log.payload as NotificationEvent).event}
      </h3>

      <h4 className="mt-4">Response Code</h4>
      <p>{log.responseCode || "None"}</p>

      <h4 className="mt-4 mb-3">Payload</h4>
      <Code
        expandable={true}
        code={JSON.stringify(log.payload, null, 2)}
        language="json"
      />

      <h4 className="mt-4">Response Body</h4>
      <code className="text-main">{log.responseBody}</code>
    </div>
  );
};
