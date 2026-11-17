import { FC, ElementType, useState, useMemo } from "react";
import { AuditInterface, EventType } from "shared/types/audit";
import { Flex } from "@radix-ui/themes";
import { DiffMethod } from "react-diff-viewer-continued";
import { PiArrowClockwise, PiCaretDown, PiCaretUp } from "react-icons/pi";
import { datetime } from "shared/dates";
import { entityEvents } from "shared/constants";
import { auditUserToEventUser } from "shared/validators";
import LazyDiffViewer from "@/components/AuditHistoryExplorer/LazyDiffViewer";
import Heading from "@/ui/Heading";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import { useDefinitions } from "@/services/DefinitionsContext";
import useApi from "@/hooks/useApi";
import Callout from "@/ui/Callout";
import UiButton from "@/ui/Button";
import { Select, SelectItem } from "@/ui/Select";
import Table, {
  TableBody,
  TableCell,
  TableColumnHeader,
  TableHeader,
  TableRow,
} from "@/ui/Table";
import Button from "./Button";
import Code from "./SyntaxHighlighting/Code";
import LoadingOverlay from "./LoadingOverlay";
import EventUser from "./Avatar/EventUser";

function EventDetails({
  eventType,
  details,
  reason,
}: {
  eventType: EventType;
  details: string;
  reason?: string;
}) {
  const json = useMemo(() => {
    try {
      return JSON.parse(details);
    } catch (e) {
      return {
        parseError: e.message,
      };
    }
  }, [details]);

  // Link to report
  if (eventType === "experiment.analysis" && json.report) {
    return <Link href={`/report/${json.report}`}>View Report</Link>;
  }

  // Diff (create, update, delete)
  if (json.pre || json.post) {
    return (
      <div className="diff-wrapper">
        {reason && (
          <p>
            <strong>Reason: </strong>
            {reason}
          </p>
        )}
        {json.context && (
          <div className="row">
            {Object.keys(json.context).map((k) => (
              <div className="col-auto mb-2" key={k}>
                <strong>{k}: </strong>
                {JSON.stringify(json.context[k])}
              </div>
            ))}
          </div>
        )}
        <LazyDiffViewer
          oldValue={JSON.stringify(json.pre || {}, null, 2)}
          newValue={JSON.stringify(json.post || {}, null, 2)}
          compareMethod={DiffMethod.LINES}
          styles={{
            contentText: {
              wordBreak: "break-all",
            },
          }}
        />
      </div>
    );
  }

  // Other - show JSON
  return (
    <>
      {reason && (
        <p>
          <strong>Reason: </strong>
          {reason}
        </p>
      )}
      <Code language="json" code={JSON.stringify(json, null, 2)} />
    </>
  );
}

export function HistoryTableRow({
  event,
  open,
  setOpen,
  showName = false,
  showType = false,
  itemName = "",
  url = "",
  Row = "tr",
  Cell = "td",
}: {
  event: AuditInterface;
  open: boolean;
  setOpen: (open: boolean) => void;
  showName?: boolean;
  showType?: boolean;
  itemName?: string;
  url?: string;
  /** Swap in the design-system Table's Row/Cell when rendering inside it. */
  Row?: ElementType;
  Cell?: ElementType;
}) {
  let colSpanNum = 4;
  if (showName) colSpanNum++;
  if (showType) colSpanNum++;

  const displayName = itemName || event.entity.name || event.entity.id;
  // The list table paints its own hover tint on each cell. The legacy table
  // still uses the highlight classes.
  const designSystem = Row !== "tr";
  const openCellStyle: React.CSSProperties | undefined =
    designSystem && open ? { backgroundColor: "var(--gray-a2)" } : undefined;

  return (
    <>
      <Row
        style={{ cursor: event.details ? "pointer" : "" }}
        className={
          designSystem
            ? undefined
            : open
              ? "highlight"
              : event.details
                ? "hover-highlight"
                : ""
        }
        onClick={(e: React.MouseEvent) => {
          // Don't toggle the row's open state if a link was clicked
          const target = e.target as HTMLElement;
          if (target && target.closest("a")) {
            return;
          }

          setOpen(!open);
        }}
      >
        <Cell title={datetime(event.dateCreated)} style={openCellStyle}>
          {datetime(event.dateCreated)}
        </Cell>
        {showType && <Cell style={openCellStyle}>{event.entity.object}</Cell>}
        {showName && (
          <Cell style={openCellStyle}>
            {url ? <Link href={url}>{displayName}</Link> : displayName}
          </Cell>
        )}
        <Cell style={openCellStyle}>
          <EventUser user={auditUserToEventUser(event.user)} display="name" />
        </Cell>
        <Cell style={openCellStyle}>{event.event}</Cell>
        <Cell style={{ width: 30, ...openCellStyle }}>
          {event.details && (open ? <PiCaretUp /> : <PiCaretDown />)}
        </Cell>
      </Row>
      {open && event.details && (
        <Row {...(designSystem ? { "data-no-hover": true } : {})}>
          <Cell
            colSpan={colSpanNum}
            className={designSystem ? undefined : "bg-light p-3"}
            style={
              designSystem
                ? {
                    backgroundColor: "var(--gray-a2)",
                    padding: "var(--space-3)",
                  }
                : undefined
            }
          >
            <EventDetails
              eventType={event.event}
              details={event.details}
              reason={event.reason}
            />
          </Cell>
        </Row>
      )}
    </>
  );
}

const HistoryTable: FC<{
  type:
    | "experiment"
    | "metric"
    | "feature"
    | "savedGroup"
    | "factTable"
    | "datasource"
    | "apiKey"
    | "project"
    | "population";
  showName?: boolean;
  showType?: boolean;
  maxHeight?: string;
  id?: string;
}> = ({ id, type, showName = false, showType = false, maxHeight }) => {
  const [cursor, setCursor] = useState<string | null>(null);
  const [cursors, setCursors] = useState<(string | null)[]>([null]); // Stack of cursors for each page
  const [eventFilter, setEventFilter] = useState("");
  const limit = 50;

  const query = `limit=${limit}${cursor ? `&cursor=${cursor}` : ""}${
    eventFilter ? `&event=${eventFilter}` : ""
  }`;
  const apiPath = id
    ? `/history/${type}/${id}?${query}`
    : `/history/${type}?${query}`;

  const { data, error, mutate } = useApi<{
    events: AuditInterface[];
    total: number;
    nextCursor?: string | null;
  }>(apiPath);

  const [open, setOpen] = useState("");
  const { getSavedGroupById } = useDefinitions();

  const events: AuditInterface[] = useMemo(() => {
    if (!data?.events) return [];
    if (!showName) return data?.events;

    return data?.events.map((event) => {
      if (event.entity.object === "savedGroup") {
        const savedGroup = getSavedGroupById(event.entity.id);
        if (savedGroup && !event.entity?.name) {
          event.entity.name = savedGroup.groupName;
        }
      }
      if (!event.entity?.name) {
        event.entity.name = event.entity.id;
      }
      return event;
    });
  }, [data?.events, showName, getSavedGroupById]);

  const currentPage = cursors.length;
  const totalPages = data ? Math.ceil(data.total / limit) : 0;
  const hasMore = data ? currentPage < totalPages : false;

  if (error) {
    return <Callout status="error">{error.message}</Callout>;
  }
  if (!data) {
    return <LoadingOverlay />;
  }

  return (
    <>
      <Flex align="center" gap="3" mb="2" wrap="wrap">
        <Heading as="h3" size="md" mb="0">
          Audit Log
        </Heading>
        <Text color="text-mid">
          {data.total} total event{data.total !== 1 ? "s" : ""}
        </Text>
        <Flex align="center" gap="2" ml="auto">
          <Select
            value={eventFilter || "all"}
            setValue={(v) => {
              setEventFilter(v === "all" ? "" : v);
              setCursor(null);
              setCursors([null]);
              setOpen("");
            }}
            size="sm"
          >
            <SelectItem value="all">All events</SelectItem>
            {[...new Set<string>(entityEvents[type])].map((e) => (
              <SelectItem key={e} value={`${type}.${e}`}>
                {type}.{e}
              </SelectItem>
            ))}
          </Select>
          <UiButton
            variant="ghost"
            size="sm"
            icon={<PiArrowClockwise />}
            onClick={() => mutate()}
          >
            Refresh
          </UiButton>
        </Flex>
      </Flex>
      {maxHeight ? (
        <Table variant="list" stickyHeader scrollX maxHeight={maxHeight}>
          <TableHeader>
            <TableRow>
              <TableColumnHeader>Date</TableColumnHeader>
              {showType && <TableColumnHeader>Type</TableColumnHeader>}
              {showName && <TableColumnHeader>Name</TableColumnHeader>}
              <TableColumnHeader>User</TableColumnHeader>
              <TableColumnHeader>Event</TableColumnHeader>
              <TableColumnHeader></TableColumnHeader>
            </TableRow>
          </TableHeader>
          <TableBody>
            {events.map((event) => (
              <HistoryTableRow
                event={event}
                key={event.id}
                showName={showName}
                showType={showType}
                open={open === event.id}
                setOpen={(open) => {
                  setOpen(open ? event.id : "");
                }}
                Row={TableRow}
                Cell={TableCell}
              />
            ))}
          </TableBody>
        </Table>
      ) : (
        <table className="table appbox">
          <thead>
            <tr>
              <th>Date</th>
              {showType && <th>Type</th>}
              {showName && <th>Name</th>}
              <th>User</th>
              <th>Event</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {events.map((event) => (
              <HistoryTableRow
                event={event}
                key={event.id}
                showName={showName}
                showType={showType}
                open={open === event.id}
                setOpen={(open) => {
                  setOpen(open ? event.id : "");
                }}
              />
            ))}
          </tbody>
        </table>
      )}
      {(currentPage > 1 || hasMore) && (
        <div className="d-flex justify-content-between align-items-center mt-3">
          <div>
            Page {currentPage} of {totalPages}
          </div>
          <div>
            <Button
              color="outline-primary"
              disabled={currentPage <= 1}
              onClick={() => {
                // Go back to previous cursor
                const newCursors = cursors.slice(0, -1);
                setCursors(newCursors);
                setCursor(newCursors[newCursors.length - 1]);
                setOpen("");
              }}
              className="mr-2"
            >
              Previous
            </Button>
            <Button
              color="outline-primary"
              disabled={!hasMore}
              onClick={() => {
                // Add the next cursor to the stack
                if (data?.nextCursor) {
                  setCursors([...cursors, data.nextCursor]);
                  setCursor(data.nextCursor);
                  setOpen("");
                }
              }}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </>
  );
};

export default HistoryTable;
