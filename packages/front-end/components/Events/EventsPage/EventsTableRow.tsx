import React, { FC, useMemo, useState } from "react";
import { EventInterface } from "shared/types/events/event";
import { datetime } from "shared/dates";
import { ApiKeyInterface } from "shared/types/apikey";
import { Box, Flex } from "@radix-ui/themes";
import { PiCaretDown, PiCaretUp } from "react-icons/pi";
import EventUser from "@/components/Avatar/EventUser";
import Link from "@/ui/Link";
import { getEventText } from "@/components/Events/EventsPage/utils";
import { EventDetail } from "@/components/Events/EventDetail/EventDetail";
import useApi from "@/hooks/useApi";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";

type EventsTableRowProps = {
  event: EventInterface;
};

export const EventsTableRow: FC<EventsTableRowProps> = ({ event }) => {
  const [showDetails, setShowDetails] = useState(false);
  const permissionsUtils = usePermissionsUtil();

  const { data } = useApi<{ keys: ApiKeyInterface[] }>("/keys", {
    shouldRun: () => permissionsUtils.canViewApiKeys(),
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
          <span className="py-1 d-block">
            {user ? (
              <EventUser
                user={
                  // Older events didn't store an org key's name.
                  user.type === "api_key" && !user.id && !user.name
                    ? { ...user, name: apiKeyDescriptions?.[user.apiKey] }
                    : user
                }
                display="name-email"
                expanded
                wrap
              />
            ) : (
              ""
            )}
          </span>
        </td>
        <td>
          <Link
            onClick={() => setShowDetails(!showDetails)}
            aria-expanded={showDetails}
          >
            <Flex as="span" align="center" gap="2">
              {getEventText(event)}
              {showDetails ? (
                <PiCaretUp aria-hidden />
              ) : (
                <PiCaretDown aria-hidden />
              )}
            </Flex>
          </Link>
        </td>
        <td className="">
          <span className="tr-hover small py-1">
            <Link href={`/events/${event.id}`}>Permalink</Link>
          </span>
        </td>
      </tr>
      {showDetails && (
        <tr>
          <td colSpan={5}>
            {/* Zero intrinsic width: long lines scroll instead of widening the table. */}
            <Box width="0" minWidth="100%">
              <EventDetail event={event} />
            </Box>
          </td>
        </tr>
      )}
    </>
  );
};
