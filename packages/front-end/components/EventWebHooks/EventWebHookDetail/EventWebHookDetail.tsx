import { EventWebHookInterface } from "back-end/types/event-webhook";
import React, { FC } from "react";
import { TbWebhook } from "react-icons/tb";
import classNames from "classnames";
import { useIconForState } from "../utils";
import { datetime } from "../../../services/dates";
import { useCopyToClipboard } from "../../../hooks/useCopyToClipboard";
import { SimpleTooltip } from "../../SimpleTooltip/SimpleTooltip";
import { HiOutlineClipboard, HiOutlineClipboardCheck } from "react-icons/hi";

type EventWebHookDetailProps = {
  eventWebHook: EventWebHookInterface;
};

export const EventWebHookDetail: FC<EventWebHookDetailProps> = ({
  eventWebHook,
}) => {
  const { lastState, lastRunAt, url, events, name, signingKey } = eventWebHook;

  const iconForState = useIconForState(eventWebHook.lastState);

  const { performCopy, copySuccess, copySupported } = useCopyToClipboard({
    timeout: 1500,
  });

  return (
    <div>
      <h1>{name}</h1>
      <h3 className="text-muted font-weight-bold">{url}</h3>

      <div className="card mt-3 p-3">
        <div className="row">
          <div className="col-xs-12 col-md-6">
            <div className="d-flex font-weight-bold align-items-center">
              {/* Last run state & date */}
              <span className="mr-2" style={{ fontSize: "1.5rem" }}>
                {iconForState}
              </span>
              {lastRunAt ? (
                <span
                  className={classNames("", {
                    "text-success": lastState === "success",
                    "text-danger": lastState === "error",
                  })}
                >
                  Last run on {datetime(lastRunAt)}
                </span>
              ) : (
                <span className="text-muted">
                  This webhook has not yet run.
                </span>
              )}
            </div>
          </div>

          <div className="col-xs-12 col-md-6 mt-2 mt-md-0">
            <div className="d-flex align-items-center">
              {copySupported ? (
                <button
                  className="btn p-0"
                  onClick={() => performCopy(signingKey)}
                >
                  <span style={{ fontSize: "1.1rem" }}>
                    {copySuccess ? (
                      <HiOutlineClipboardCheck />
                    ) : (
                      <HiOutlineClipboard />
                    )}
                  </span>
                </button>
              ) : null}
              <span className="ml-3">
                <code className="text-main">{signingKey}</code>
              </span>

              {copySuccess ? (
                <SimpleTooltip position="bottom">
                  Webhook secret copied to clipboard!
                </SimpleTooltip>
              ) : null}
            </div>
          </div>
        </div>

        <div className="d-flex align-items-center mt-2">
          <span className="text-muted ml-1 mr-2" style={{ fontSize: "1rem" }}>
            <TbWebhook className="d-block" />
          </span>
          <span className="font-weight-bold">&nbsp;Events</span>
          <div className="flex-grow-1 d-flex flex-wrap ml-3">
            {events.map((eventName) => (
              <span key={eventName} className="mr-2 badge badge-purple">
                {eventName}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export const EventWebHookDetailContainer = () => {
  return null;
};
