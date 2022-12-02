import React, { FC, useMemo } from "react";
import { EventWebHookInterface } from "back-end/types/event-webhook";
import { BsCheck, BsQuestion, BsX } from "react-icons/all";
import { datetime } from "../../services/dates";

type EventWebHookListItemProps = {
  href: string;
  eventWebHook: EventWebHookInterface;
};

export const EventWebHookListItem: FC<EventWebHookListItemProps> = ({
  href,
  eventWebHook,
}) => {
  const { name, url, lastState, lastRunAt } = eventWebHook;

  const iconForState = useMemo(() => {
    switch (lastState) {
      case "none":
        return <BsQuestion className="text-muted" />;
      case "success":
        return <BsCheck className="text-success" />;
      case "error":
        return <BsX className="text-danger" />;
      default:
        return null;
    }
  }, [lastState]);

  return (
    <a href={href} style={{ textDecoration: "none" }} className="card p-3">
      <div className="d-flex justify-content-md-between align-items-center">
        <div>
          <h2 className="text-main">{name}</h2>
          <h3 className="text-muted">{url}</h3>
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
  );
};
