import React, { Fragment, ReactNode, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import {
  PiCaretDown,
  PiCaretRight,
  PiCheck,
  PiWarningFill,
} from "react-icons/pi";
import { ago, datetime } from "shared/dates";
import { EventWebHookLogInterface } from "shared/types/event-webhook-log";
import SectionFrame from "@/components/SectionFrame";
import Code from "@/components/SyntaxHighlighting/Code";
import Badge from "@/ui/Badge";
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

// Failures among the latest deliveries: a health check, not a running tally.
export function recentFailures(logs: EventWebHookLogInterface[]) {
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

// How the webhook is doing: its latest result and any setup checks, then each
// request it sent.
export default function EventWebHookStatus({
  logs,
  children,
}: {
  logs: EventWebHookLogInterface[];
  children?: ReactNode;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [latest] = logs;
  const recent = recentFailures(logs);

  return (
    <>
      <SectionFrame title="Status">
        {latest ? (
          <Flex align="center" gap="2" wrap="wrap">
            <Text>Last delivery</Text>
            <DeliveryStatusBadge log={latest} />
            <Tooltip content={datetime(latest.dateCreated)}>
              <Text color="text-mid">{ago(latest.dateCreated)}</Text>
            </Tooltip>
            <Text color="text-mid">
              ·{" "}
              {recent.failed
                ? `${recent.failed} of the last ${recent.total} failed`
                : `The last ${recent.total} succeeded`}
            </Text>
          </Flex>
        ) : (
          <Text color="text-mid">
            No deliveries yet. Use Send test to check the setup.
          </Text>
        )}
        {children}
      </SectionFrame>

      <SectionFrame title="Deliveries" mt="4">
        {logs.length ? (
          <Table variant="ghost">
            <TableHeader>
              <TableRow>
                <TableColumnHeader width="32px" />
                <TableColumnHeader width="180px">Time</TableColumnHeader>
                <TableColumnHeader>Event</TableColumnHeader>
                <TableColumnHeader width="160px">Result</TableColumnHeader>
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
                        {open ? <PiCaretDown /> : <PiCaretRight />}
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
        ) : (
          <Text color="text-mid">Nothing sent yet.</Text>
        )}
      </SectionFrame>
    </>
  );
}
