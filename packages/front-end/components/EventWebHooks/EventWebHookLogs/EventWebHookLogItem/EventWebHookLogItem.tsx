import React, { FC } from "react";
import { datetime } from "../../../../services/dates";
import { NotificationEvent } from "back-end/dist/events/base-events";
import { EventWebHookLogInterface } from "back-end/types/event-webhook-log";
import classNames from "classnames";

type EventWebHookLogItemProps = {
  log: EventWebHookLogInterface;
  activeLogId: string | null;
  onClick: (logId: string) => void;
};

export const EventWebHookLogItem: FC<EventWebHookLogItemProps> = ({
  log,
  activeLogId,
  onClick,
}) => {
  const payload = log.payload as NotificationEvent;

  return (
    <tr
      className={classNames("cursor-pointer", {
        highlight: activeLogId === log.id,
      })}
      onClick={() => onClick(log.id)}
    >
      <td>{log.result}</td>
      <td>
        <code>{payload.event}</code>
      </td>
      <td>{datetime(log.dateCreated)}</td>
    </tr>
  );
};
