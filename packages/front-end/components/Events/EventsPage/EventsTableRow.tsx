import React, { FC } from "react";
import { EventInterface } from "back-end/types/event";
import { NotificationEvent } from "back-end/src/events/notification-events";
import { datetime } from "shared/dates";
import { getEventText } from "./utils";

type EventsTableRowProps = {
  event: EventInterface<NotificationEvent>;
};

export const EventsTableRow: FC<EventsTableRowProps> = ({ event }) => {
  return (
    <tr>
      <td>
        <span className="py-2 d-block nowrap">
          {datetime(event.dateCreated)}
        </span>
      </td>
      <td>
        <p className="py-2 mb-0">{getEventText(event)}</p>

        <p className="my-0 py-1">
          <a href={`/events/${event.id}`}>View Event</a>
        </p>
      </td>
    </tr>
  );
};
