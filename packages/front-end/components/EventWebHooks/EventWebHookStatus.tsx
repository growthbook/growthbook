import React, { Fragment, ReactNode, useState } from "react";
import { Box, Flex, VisuallyHidden } from "@radix-ui/themes";
import {
  PiCaretDown,
  PiCaretRight,
  PiCheck,
  PiWarningFill,
} from "react-icons/pi";
import { ago, datetime } from "shared/dates";
import { EventWebHookLogInterface } from "shared/types/event-webhook-log";
import { EventWebHookInterface } from "shared/types/event-webhook";
import SectionFrame from "@/components/SectionFrame";
import SetupFieldRow from "@/components/Experiment/TabbedPage/SetupFieldRow";
import Code from "@/components/SyntaxHighlighting/Code";
import LoadingSpinner from "@/components/LoadingSpinner";
import Badge from "@/ui/Badge";
import Callout from "@/ui/Callout";
import Button from "@/ui/Button";
import Table, {
  TableBody,
  TableCell,
  TableColumnHeader,
  TableHeader,
  TableRow,
  TableViewportCell,
} from "@/ui/Table";
import Text from "@/ui/Text";
import Tooltip from "@/ui/Tooltip";

const RECENT_DELIVERIES = 10;

// Settings pages shade table headers; inside a card the header sits on it.
const flushHeader = { backgroundColor: "transparent" };

// Failures among the latest deliveries: a health check, not a running tally.
function recentFailures(logs: EventWebHookLogInterface[]) {
  const recent = logs.slice(0, RECENT_DELIVERIES);
  return {
    total: recent.length,
    failed: recent.filter((log) => log.result !== "success").length,
  };
}

export function DeliveryStatusBadge({
  log,
}: {
  log: Pick<EventWebHookLogInterface, "result" | "responseCode">;
}) {
  return log.result === "success" ? (
    <Badge
      label={
        <>
          <PiCheck />
          Delivered
        </>
      }
      color="green"
      variant="soft"
    />
  ) : (
    <Badge
      label={
        <>
          <PiWarningFill />
          {log.responseCode ? `Failed (${log.responseCode})` : "Failed"}
        </>
      }
      color="red"
      variant="soft"
    />
  );
}

// Like an experiment's status: whether it's on, and whether its last delivery
// failed.
export function WebhookStatusBadge({
  webhook,
}: {
  webhook: Pick<EventWebHookInterface, "enabled" | "lastState">;
}) {
  if (!webhook.enabled) {
    return (
      <Badge label="Disabled" color="gray" variant="solid" radius="full" />
    );
  }
  if (webhook.lastState === "error") {
    return (
      <Tooltip content="The last delivery failed.">
        <Badge
          label="Enabled: Unhealthy"
          color="amber"
          variant="solid"
          radius="full"
          style={{ cursor: "default" }}
        />
      </Tooltip>
    );
  }
  return <Badge label="Enabled" color="indigo" variant="solid" radius="full" />;
}

export function LastDelivery({
  log,
  date,
}: {
  log: Pick<EventWebHookLogInterface, "result" | "responseCode">;
  date: Date | string;
}) {
  return (
    <Flex align="center" gap="2">
      <DeliveryStatusBadge log={log} />
      <Tooltip content={datetime(date)}>
        <Text color="text-mid" whiteSpace="nowrap">
          {ago(date)}
        </Text>
      </Tooltip>
    </Flex>
  );
}

function DeliveryDetails({ log }: { log: EventWebHookLogInterface }) {
  return (
    <Flex direction="column" gap="3" py="2">
      {log.url ? (
        <Box>
          <Text as="div" weight="medium" mb="1">
            Request
          </Text>
          <Text size="sm" mono overflowWrap="anywhere">
            {log.method ? `${log.method} ` : null}
            {log.url}
          </Text>
        </Box>
      ) : null}
      <Box>
        <Text as="div" weight="medium" mb="1">
          Payload
        </Text>
        <Code
          expandable
          code={JSON.stringify(log.payload, null, 2)}
          language="json"
        />
      </Box>
      <Box>
        <Text as="div" weight="medium" mb="1">
          Response
        </Text>
        {log.responseBody ? (
          <Code code={log.responseBody} language="none" wrapLongLines />
        ) : (
          <Text color="text-mid">No response body.</Text>
        )}
      </Box>
    </Flex>
  );
}

export default function EventWebHookStatus({
  logs,
  error,
  canTest,
  children,
}: {
  // Null while loading.
  logs: EventWebHookLogInterface[] | null;
  error: string | null;
  canTest: boolean;
  children?: ReactNode;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [latest] = logs ?? [];
  const recent = recentFailures(logs ?? []);

  return (
    <>
      <SectionFrame title="Status">
        {error ? (
          <Callout status="error">
            Deliveries couldn&apos;t be loaded. {error}
          </Callout>
        ) : !logs ? null : latest ? (
          <>
            <SetupFieldRow label="Last delivery" content="text">
              <LastDelivery log={latest} date={latest.dateCreated} />
            </SetupFieldRow>
            <SetupFieldRow label="Recent deliveries" content="text">
              <Text>
                {recent.failed
                  ? `${recent.failed} of the last ${recent.total} failed`
                  : `The last ${recent.total} succeeded`}
              </Text>
            </SetupFieldRow>
          </>
        ) : (
          <Text color="text-mid">
            {canTest
              ? "No deliveries yet. Use Send test to check the setup."
              : "No deliveries yet."}
          </Text>
        )}
        {children}
      </SectionFrame>

      {error || logs?.length === 0 ? null : (
        <SectionFrame title="Deliveries" mt="4">
          {!logs ? (
            <LoadingSpinner />
          ) : (
            <Table variant="ghost">
              <TableHeader>
                <TableRow>
                  <TableColumnHeader width="32px" style={flushHeader}>
                    <VisuallyHidden>Details</VisuallyHidden>
                  </TableColumnHeader>
                  <TableColumnHeader width="180px" style={flushHeader}>
                    Time
                  </TableColumnHeader>
                  <TableColumnHeader style={flushHeader}>
                    Event
                  </TableColumnHeader>
                  <TableColumnHeader width="160px" style={flushHeader}>
                    Result
                  </TableColumnHeader>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.map((log) => {
                  const open = openId === log.id;
                  return (
                    <Fragment key={log.id}>
                      <TableRow
                        style={{ cursor: "pointer" }}
                        onClick={() => setOpenId(open ? null : log.id)}
                      >
                        <TableCell>
                          <Button
                            variant="ghost"
                            color="gray"
                            size="sm"
                            aria-label="Delivery details"
                            aria-expanded={open}
                            stopPropagation
                            onClick={() => setOpenId(open ? null : log.id)}
                          >
                            {open ? <PiCaretDown /> : <PiCaretRight />}
                          </Button>
                        </TableCell>
                        <TableCell>
                          <Tooltip content={datetime(log.dateCreated)}>
                            <span>{ago(log.dateCreated)}</span>
                          </Tooltip>
                        </TableCell>
                        <TableCell>
                          <Text size="sm" mono>
                            {log.event ?? "unknown"}
                          </Text>
                        </TableCell>
                        <TableCell>
                          <DeliveryStatusBadge log={log} />
                        </TableCell>
                      </TableRow>
                      {open ? (
                        <TableRow>
                          <TableViewportCell colSpan={4}>
                            <DeliveryDetails log={log} />
                          </TableViewportCell>
                        </TableRow>
                      ) : null}
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </SectionFrame>
      )}
    </>
  );
}
