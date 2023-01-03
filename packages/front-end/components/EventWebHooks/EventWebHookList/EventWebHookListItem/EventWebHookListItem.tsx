import React, { FC } from "react";
import Link from "next/link";
import { EventWebHookInterface } from "back-end/types/event-webhook";
import { datetime } from "../../../../services/dates";
import { useIconForState } from "../../utils";

type EventWebHookListItemProps = {
  href: string;
  eventWebHook: EventWebHookInterface;
};

export const EventWebHookListItem: FC<EventWebHookListItemProps> = ({
  href,
  eventWebHook,
}) => {
  const { name, url, lastState, lastRunAt } = eventWebHook;

  const iconForState = useIconForState(lastState);

  return (
    <Link href={href}>
      <a style={{ textDecoration: "none" }} className="card p-3">
        <div className="d-flex justify-content-md-between align-items-center">
          <div className="mr-4">
            <h3 className="text-main">{name}</h3>
            <h4 className="text-muted">{url}</h4>
          </div>
          <div className="d-flex justify-content-md-between align-items-center">
            {!lastRunAt ? (
              <div className="text-muted">No runs</div>
            ) : (
              <div className="text-main">Last run: {datetime(lastRunAt)}</div>
            )}
            <div className="ml-2" style={{ fontSize: "1.5rem" }}>
              {iconForState}
            </div>
          </div>
        </div>
      </a>
    </Link>
  );
};
