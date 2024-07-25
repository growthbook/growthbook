import React, { FC, useState } from "react";
import { EventInterface } from "back-end/types/event";
import { NotificationEvent } from "back-end/src/events/notification-events";
import { datetime } from "shared/dates";
import { FaAngleDown, FaAngleUp } from "react-icons/fa";
import Link from "next/link";
import { getEventText } from "@/components/Events/EventsPage/utils";
import Code from "@/components/SyntaxHighlighting/Code";

type EventsTableRowProps = {
  event: EventInterface<NotificationEvent>;
};

export const EventsTableRow: FC<EventsTableRowProps> = ({ event }) => {
  const [showDetails, setShowDetails] = useState(false);
  return (
    <>
      <tr>
        <td>
          <span className="py-1 d-block nowrap">
            {datetime(event.dateCreated)}
          </span>
        </td>
        <td>
          <span className="py-1 d-block nowrap">{event.event}</span>
        </td>
        <td>
          <span className="py-1 d-block nowrap">
            {/* eslint-disable-next-line no-unsafe-optional-chaining */}
            {event.data?.user && "name" in event.data?.user ? (
              <span title={event.data.user.email}>{event.data.user.name}</span>
            ) : (
              ""
            )}
          </span>
        </td>
        <td>
          <a
            href={`/events/${event.id}`}
            onClick={(e) => {
              e.preventDefault();
              setShowDetails(!showDetails);
            }}
          >
            <div className="d-flex align-items-center py-1">
              <p className="mb-0">{getEventText(event)}</p>
              {showDetails ? (
                <FaAngleUp className="ml-2" />
              ) : (
                <FaAngleDown className="ml-2" />
              )}
            </div>
          </a>
          {showDetails && (
            <div>
              <div className="mt-2">
                <Code
                  language="json"
                  filename={event.data.event}
                  code={JSON.stringify(event.data, null, 2)}
                  expandable={false}
                />
              </div>
              <Link href={`/events/${event.id}`}>Permalink to Event</Link>
            </div>
          )}
        </td>
        <td className="">
          <span className="tr-hover small py-1">
            <Link href={`/events/${event.id}`}>Permalink</Link>
          </span>
        </td>
      </tr>
    </>
  );
};
