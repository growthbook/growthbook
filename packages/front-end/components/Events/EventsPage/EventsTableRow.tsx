import React, { FC, useMemo, useState } from "react";
import { EventInterface } from "shared/types/events/event";
import { datetime } from "shared/dates";
import { FaAngleDown, FaAngleUp } from "react-icons/fa";
import Link from "next/link";
import { ApiKeyInterface } from "shared/types/apikey";
import { getEventText } from "@/components/Events/EventsPage/utils";
import Code from "@/components/SyntaxHighlighting/Code";
import useApi from "@/hooks/useApi";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";

type EventsTableRowProps = {
  event: EventInterface;
};

export const EventsTableRow: FC<EventsTableRowProps> = ({ event }) => {
  const [showDetails, setShowDetails] = useState(false);
  const permissionsUtils = usePermissionsUtil();

  const { data } = useApi<{ keys: ApiKeyInterface[] }>("/keys", {
    shouldRun: () => permissionsUtils.canCreateApiKey(),
  });

  const apiKeyDescriptions = useMemo(() => {
    if (!data) return undefined;
    return Object.fromEntries<string | undefined>(
      data.keys
        .filter((key) => (key.id ?? "").length > 0)
        .map((key) => {
          return [key.id!, key.description];
        }),
    );
  }, [data]);

  const user = event.data?.user;
  return (
    <>
      <tr>
        <td>
          <span className="py-1 d-block nowrap">
            {datetime(event.dateCreated)}
          </span>
        </td>
        <td>
          <span className="py-1 d-block nowrap">{event.event}</span>
        </td>
        <td>
          <span className="py-1 d-block nowrap">
            {user?.type === "dashboard" ? (
              <span title={user.email}>{user.name}</span>
            ) : user?.type === "api_key" ? (
              <span title={apiKeyDescriptions?.[user.apiKey] ?? user.apiKey}>
                API Key
              </span>
            ) : user?.type === "system" ? (
              <span title="An automatic process or background job not associated with a user">
                System
              </span>
            ) : (
              ""
            )}
          </span>
        </td>
        <td>
          <a
            href={`/events/${event.id}`}
            onClick={(e) => {
              e.preventDefault();
              setShowDetails(!showDetails);
            }}
          >
            <div className="d-flex align-items-center py-1">
              <p className="mb-0">{getEventText(event)}</p>
              {showDetails ? (
                <FaAngleUp className="ml-2" />
              ) : (
                <FaAngleDown className="ml-2" />
              )}
            </div>
          </a>
          {showDetails && (
            <div>
              <div className="mt-2">
                <Code
                  language="json"
                  filename={event.data.event}
                  code={JSON.stringify(event.data, null, 2)}
                  expandable={false}
                />
              </div>
              <Link href={`/events/${event.id}`}>Permalink to Event</Link>
            </div>
          )}
        </td>
        <td className="">
          <span className="tr-hover small py-1">
            <Link href={`/events/${event.id}`}>Permalink</Link>
          </span>
        </td>
      </tr>
    </>
  );
};
