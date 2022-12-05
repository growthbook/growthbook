import React, { FC } from "react";
import { EventWebHookInterface } from "back-end/types/event-webhook";
import { EventWebHookListItem } from "./EventWebHookListItem/EventWebHookListItem";

type EventWebHookListProps = {
  eventWebHooks: EventWebHookInterface[];
};

export const EventWebHookList: FC<EventWebHookListProps> = ({
  eventWebHooks,
}) => {
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
