import React, { FC } from "react";
import { EventWebHookInterface } from "back-end/types/event-webhook";

type EventWebHookListItemProps = {
  eventWebHook: EventWebHookInterface;
};

export const EventWebHookListItem: FC<EventWebHookListItemProps> = ({
  eventWebHook,
}) => {
  return (
    <div>
      <h1>EventWebHookListItem</h1>

      <pre>{JSON.stringify(eventWebHook, null, 2)}</pre>
    </div>
  );
};
