import React, { FC } from "react";
import { EventWebHookInterface } from "back-end/types/event-webhook";
import { EventWebHookListItem } from "./EventWebHookListItem/EventWebHookListItem";
import { FaBolt } from "react-icons/fa";

type EventWebHookListProps = {
  eventWebHooks: EventWebHookInterface[];
};

export const EventWebHookList: FC<EventWebHookListProps> = ({
  eventWebHooks,
}) => {
  if (!eventWebHooks.length) {
    return (
      <div className="row">
        <div className="col-xs-12 col-md-6 offset-md-3">
          <div className="card text-center p-3">
            When Event Webhooks are created, they will show up here.
            <div className="mt-4">
              <button className="btn btn-primary">
                <FaBolt /> Create an Event Webhook
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div>
      {eventWebHooks.map((eventWebHook) => (
        <div key={eventWebHook.id} className="mb-3">
          <EventWebHookListItem
            href={`/webhooks/${eventWebHook.id}`}
            eventWebHook={eventWebHook}
          />
        </div>
      ))}
    </div>
  );
};

export const EventWebHookListContainer = () => {
  return <EventWebHookList eventWebHooks={[]} />;
};
