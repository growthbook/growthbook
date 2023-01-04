import React, { FC } from "react";
import { NotificationEvent } from "back-end/src/events/base-events";
import { EventWebHookLogInterface } from "back-end/types/event-webhook-log";
import classNames from "classnames";
import { datetime } from "../../../../services/dates";
import { useIconForState } from "../../utils";

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

  const iconForState = useIconForState(log.result);

  return (
    <tr
      className={classNames("cursor-pointer", {
        highlight: activeLogId === log.id,
      })}
      onClick={() => onClick(log.id)}
    >
      <td className="text-center">
        <span className="d-inline-block" style={{ fontSize: "1.5rem" }}>
          {iconForState}
        </span>
      </td>
      <td className="text-left">
        <code className="text-main">{payload.event}</code>
      </td>
      <td className="text-left">{datetime(log.dateCreated)}</td>
    </tr>
  );
};
