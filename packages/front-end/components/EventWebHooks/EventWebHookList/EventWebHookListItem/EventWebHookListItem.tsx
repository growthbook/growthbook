import React, { FC } from "react";
import Link from "next/link";
import { EventWebHookInterface } from "back-end/types/event-webhook";
import { datetime } from "shared/dates";
import { useIconForState } from "@/components/EventWebHooks/utils";

type EventWebHookListItemProps = {
  href: string;
  eventWebHook: EventWebHookInterface;
};

const MAX_EVENTS_DISPLAY = 5;

const webhookIcon = {
  discord: "/images/discord.png",
  slack: "/images/slack.png",
  raw: "/images/raw-webhook.png",
} as const;

export const EventWebHookListItem: FC<EventWebHookListItemProps> = ({
  href,
  eventWebHook,
}) => {
  const {
    name,
    payloadType,
    url,
    events,
    enabled,
    lastState,
    lastRunAt,
  } = eventWebHook;

  const iconForState = useIconForState(lastState);

  if (!payloadType) return null;

  const displayedEvents = [
    ...events
      .slice(0, MAX_EVENTS_DISPLAY)
      .map((event) => <code key={event}>{event}</code>),
    ...(events.length > MAX_EVENTS_DISPLAY ? ["..."] : []),
  ];

  return (
    <Link href={href} style={{ textDecoration: "none" }} className="card p-3">
      <div className="d-flex">
        <div className="ml-2">
          <div className="m-2 p-2 border rounded">
            <img
              src={webhookIcon[payloadType]}
              style={{ height: "2rem", width: "2rem" }}
            />
          </div>
        </div>
        <div className="mr-4 ml-3">
          <div className="d-flex">
            <h3 className="link-purple text-truncate">{name}</h3>
            {enabled && (
              <div>
                <span className="badge badge-gray text-uppercase ml-2">
                  Enabled
                </span>
              </div>
            )}
          </div>
          <div className="d-flex">
            {!lastRunAt ? (
              <div className="text-muted">No runs</div>
            ) : (
              <div className="text-main d-flex">
                <b>Last run:</b> {datetime(lastRunAt)}
                <span className="ml-2" style={{ fontSize: "1.5rem" }}>
                  {iconForState}
                </span>
              </div>
            )}
            {payloadType === "raw" && (
              <span className="text-muted ml-2 d-flex">
                |
                <div
                  className="ml-2 text-truncate"
                  style={{ maxWidth: "30vw" }}
                >
                  {url}
                </div>
              </span>
            )}
          </div>
          <div className="text-main">
            <b>Events enabled:</b>{" "}
            {displayedEvents.reduce(
              (element, text) => (
                <>
                  {element ? <>{element}, </> : null}
                  {text}
                </>
              ),
              null
            )}
          </div>
        </div>
      </div>
    </Link>
  );
};
