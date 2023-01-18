import React, { FC, useState } from "react";
import {
  EventInterface,
  NotificationEventName,
  NotificationEventPayload,
  NotificationEventResource,
} from "back-end/types/event";
import { datetime } from "@/services/dates";
import Code from "../../SyntaxHighlighting/Code";
import { getEventText } from "./utils";

type EventsTableRowProps = {
  event: EventInterface<
    NotificationEventPayload<
      NotificationEventName,
      NotificationEventResource,
      unknown
    >
  >;
};

export const EventsTableRow: FC<EventsTableRowProps> = ({ event }) => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <tr
      style={{ cursor: "pointer" }}
      className={isOpen ? "highlight" : "hover-highlight"}
      onClick={(e) => {
        // Don't toggle the row's open state if a button in the code block was clicked, e.g. Copy, Expand
        const target = e.target as HTMLElement;
        if (target && target.closest("[role='button']")) {
          return;
        }

        setIsOpen(!isOpen);
      }}
    >
      <td>
        <span className="py-2 d-block">{datetime(event.dateCreated)}</span>
      </td>
      <td>
        <p className="py-2 mb-0">{getEventText(event)}</p>

        {isOpen && (
          <div className="mt-2">
            <Code
              language="json"
              filename={event.data.event}
              code={JSON.stringify(event.data, null, 2)}
              expandable={true}
            />
          </div>
        )}
      </td>
    </tr>
  );
};
