import React, { FC } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { PiArrowRight, PiPlus } from "react-icons/pi";
import { EventWebHookInterface } from "shared/types/event-webhook";
import useApi from "@/hooks/useApi";
import { useDefinitions } from "@/services/DefinitionsContext";
import { DocLink } from "@/components/DocLink";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import LinkButton from "@/ui/LinkButton";
import Callout from "@/ui/Callout";
import Frame from "@/ui/Frame";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import Tooltip from "@/ui/Tooltip";
import Link from "@/ui/Link";
import Badge from "@/ui/Badge";
import Table, {
  TableBody,
  TableCell,
  TableColumnHeader,
  TableHeader,
  TableRow,
} from "@/ui/Table";
import { SettingsPageHeader } from "@/components/Layout/SettingsPage";
import {
  slackSettingsHref,
  WebhookIcon,
  displayedEvents,
} from "@/components/EventWebHooks/utils";
import {
  LastDelivery,
  DisabledBadge,
} from "@/components/EventWebHooks/EventWebHookStatus";

const MAX_EVENTS_DISPLAY = 3;

// Chat webhook URLs carry their own credentials.
const SHOWS_ENDPOINT = new Set(["raw", "json", "datadog"]);

type EventWebHookListProps = {
  eventWebHooks: EventWebHookInterface[];
  isLoaded: boolean;
  errorMessage: string | null;
};

export const EventWebHookList: FC<EventWebHookListProps> = ({
  eventWebHooks,
  isLoaded,
  errorMessage,
}) => {
  const permissionsUtils = usePermissionsUtil();
  const canManageSlack = permissionsUtils.canManageIntegrations();

  return (
    <div>
      <SettingsPageHeader
        as="h2"
        title="Webhooks"
        actions={
          permissionsUtils.canManageSomeEventWebhooks() ? (
            <LinkButton href="/settings/webhooks/event/new" icon={<PiPlus />}>
              Add webhook
            </LinkButton>
          ) : null
        }
      />

      {/* Feedback messages */}
      {errorMessage && (
        <Callout status="error" my="3">
          {errorMessage}
        </Callout>
      )}

      {/* Empty state*/}
      {isLoaded && !errorMessage && eventWebHooks.length === 0 && (
        <Frame py="7">
          <Flex direction="column" align="center" gap="2">
            <Heading as="h3" size="lg">
              Monitor Specific Events
            </Heading>
            <Box maxWidth="560px">
              <Text as="p" align="center" color="text-mid" mb="2">
                Send targeted notifications to popular apps like Discord and
                Slack. Apply globally for all features and experiments, or
                filter by environment, project, or tags.
              </Text>
            </Box>
            <DocLink docSection="eventWebhooks">
              Setup instructions <PiArrowRight />
            </DocLink>
          </Flex>
        </Frame>
      )}

      {eventWebHooks.length > 0 && (
        <Table variant="surface">
          <TableHeader>
            <TableRow>
              <TableColumnHeader>Webhook</TableColumnHeader>
              <TableColumnHeader>Endpoint</TableColumnHeader>
              <TableColumnHeader>Events</TableColumnHeader>
              <TableColumnHeader>Filters</TableColumnHeader>
              <TableColumnHeader>Last delivery</TableColumnHeader>
            </TableRow>
          </TableHeader>
          <TableBody>
            {eventWebHooks.map((eventWebHook) => {
              const { id, name, payloadType, url, events, lastState } =
                eventWebHook;
              if (!payloadType) return null;
              const slackHref = slackSettingsHref(eventWebHook);
              const managedInSlack = !!slackHref;
              const href =
                slackHref && canManageSlack
                  ? slackHref
                  : `/settings/webhooks/event/${id}`;

              return (
                <TableRow key={id} align="start">
                  <TableCell minWidth="200px">
                    <Flex align="start" gap="2">
                      {/* Centered on the name's first line. */}
                      <Flex
                        align="center"
                        flexShrink="0"
                        style={{ height: "1lh" }}
                      >
                        <WebhookIcon
                          type={payloadType}
                          style={{ height: 18, width: 18 }}
                        />
                      </Flex>
                      <Link href={href}>{name}</Link>
                    </Flex>
                    {managedInSlack ? (
                      <Box mt="1">
                        <Badge
                          label="Managed in Slack settings"
                          color="purple"
                          variant="soft"
                        />
                      </Box>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    {SHOWS_ENDPOINT.has(payloadType) ? (
                      <Text size="sm" mono overflowWrap="anywhere">
                        {url}
                      </Text>
                    ) : (
                      <Tooltip content="Slack and Discord webhook URLs carry their own credentials, so they aren't shown.">
                        <Text
                          size="inherit"
                          color="text-mid"
                          fontStyle="italic"
                        >
                          hidden
                        </Text>
                      </Tooltip>
                    )}
                  </TableCell>
                  <TableCell>
                    {displayedEvents(events, {
                      maxEventsDisplay: MAX_EVENTS_DISPLAY,
                    })}
                  </TableCell>
                  <TableCell>
                    <WebhookFilters webhook={eventWebHook} />
                  </TableCell>
                  <TableCell>
                    {!eventWebHook.enabled ? (
                      <DisabledBadge />
                    ) : eventWebHook.lastRunAt && lastState !== "none" ? (
                      <LastDelivery
                        log={{ result: lastState, responseCode: null }}
                        date={eventWebHook.lastRunAt}
                      />
                    ) : (
                      <Badge label="Never fired" color="gray" variant="soft" />
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </div>
  );
};

// The environments, Projects and tags a webhook is limited to.
function WebhookFilters({ webhook }: { webhook: EventWebHookInterface }) {
  const { getProjectById } = useDefinitions();
  const filters = [
    { label: "Environments", values: webhook.environments ?? [] },
    {
      label: "Projects",
      values: (webhook.projects ?? []).map(
        (id) => getProjectById(id)?.name ?? id,
      ),
    },
    { label: "Tags", values: webhook.tags ?? [] },
  ].filter((filter) => filter.values.length > 0);
  if (!filters.length) return null;
  return (
    <Flex direction="column" gap="1">
      {filters.map(({ label, values }) => (
        <Text key={label} size="inherit">
          <Text size="inherit" color="text-mid">
            {label}:
          </Text>{" "}
          {values.join(", ")}
        </Text>
      ))}
    </Flex>
  );
}

export const EventWebHookListContainer = () => {
  const { data, error } = useApi<{
    eventWebHooks: EventWebHookInterface[];
  }>("/event-webhooks");

  return (
    <EventWebHookList
      eventWebHooks={data?.eventWebHooks || []}
      isLoaded={!!data}
      errorMessage={error?.message || null}
    />
  );
};
