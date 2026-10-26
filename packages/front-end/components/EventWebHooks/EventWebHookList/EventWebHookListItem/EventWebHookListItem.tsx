import React, { FC } from "react";
import Link from "next/link";
import { EventWebHookInterface } from "shared/types/event-webhook";
import { datetime } from "shared/dates";
import { Flex } from "@radix-ui/themes";
import {
  WebhookIcon,
  useIconForState,
  displayedEvents,
} from "@/components/EventWebHooks/utils";
import Badge from "@/ui/Badge";

type EventWebHookListItemProps = {
  href: string;
  eventWebHook: EventWebHookInterface;
};

const MAX_EVENTS_DISPLAY = 5;

export const EventWebHookListItem: FC<EventWebHookListItemProps> = ({
  href,
  eventWebHook,
}) => {
  const { name, payloadType, url, events, enabled, lastState, lastRunAt } =
    eventWebHook;

  const iconForState = useIconForState(lastState);

  if (!payloadType) return null;

  const detailedWebhook = ["raw", "json"].includes(payloadType);
  const managedInSlack =
    payloadType === "slack" && !!eventWebHook.slack?.teamId;

  return (
    <Link
      href={href}
      style={{ textDecoration: "none", padding: "16px 20px" }}
      className="card"
    >
      <Flex gap="16px">
        <Flex
          align="center"
          justify="center"
          flexShrink="0"
          width="44px"
          height="44px"
          style={{
            border: "1px solid var(--gray-a5)",
            borderRadius: "var(--radius-3)",
          }}
        >
          <WebhookIcon type={payloadType} style={{ height: 22, width: 22 }} />
        </Flex>
        <Flex direction="column" gap="6px" minWidth="0">
          <div className="d-flex align-items-center">
            <h3 className="link-purple text-truncate mb-0">{name}</h3>
            {enabled && (
              <div>
                <span className="badge badge-gray text-uppercase ml-2">
                  Enabled
                </span>
              </div>
            )}
            {managedInSlack && (
              <Badge
                label="Managed in Slack settings"
                color="purple"
                variant="soft"
                ml="2"
              />
            )}
          </div>
          <div className="d-flex">
            {!lastRunAt ? (
              <div className="text-muted">No runs</div>
            ) : (
              <div className="text-main d-flex">
                <b className="mr-1">Last run:</b> {datetime(lastRunAt)}
                <span className="ml-2" style={{ fontSize: "1.5rem" }}>
                  {iconForState}
                </span>
              </div>
            )}
            {detailedWebhook && (
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
            {displayedEvents(events, {
              maxEventsDisplay: MAX_EVENTS_DISPLAY,
            })}
          </div>
        </Flex>
      </Flex>
    </Link>
  );
};
