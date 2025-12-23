import React, { FC } from "react";
import { EventWebHookLogInterface } from "shared/types/event-webhook-log";
import classNames from "classnames";
import { datetime } from "shared/dates";
import { useIconForState } from "@/components/EventWebHooks/utils";

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
  const iconForState = useIconForState(log.result);

  return (
    <tr
      className={classNames("cursor-pointer", {
        highlight: activeLogId === log.id,
      })}
      onClick={() => onClick(log.id)}
    >
      <td className="text-left table-column-fit-width pr-5">
        {datetime(log.dateCreated)}
      </td>
      <td className="text-left">
        <code className="text-main">
          {log.event ?? <span className="font-italic">unknown</span>}
        </code>
      </td>
      <td className="text-left">
        <span className="d-inline-block" style={{ fontSize: "1.5rem" }}>
          {iconForState}
        </span>
      </td>
    </tr>
  );
};
