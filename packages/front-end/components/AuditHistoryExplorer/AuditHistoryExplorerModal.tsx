import { useMemo, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import ReactDiffViewer, { DiffMethod } from "react-diff-viewer";
import { FaAngleDown, FaAngleUp } from "react-icons/fa";
import { PiArrowsClockwise } from "react-icons/pi";
import { AuditInterface, EventType } from "shared/types/audit";
import { datetime } from "shared/dates";
import Link from "next/link";
import Modal from "@/components/Modal";
import Button from "@/ui/Button";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import Code from "@/components/SyntaxHighlighting/Code";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/Tabs";
import { AuditDiffConfig } from "./types";
import { COMPACT_DIFF_STYLES } from "./CompareAuditEventsUtils";
import {
  PAGE_LIMIT,
  useAuditEntries,
  UseAuditEntriesResult,
} from "./useAuditEntries";
import CompareAuditEvents from "./CompareAuditEvents";

// ---- Raw Audit Log Tab ----

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
      return { parseError: e.message };
    }
  }, [details]);

  if (eventType === "experiment.analysis" && json.report) {
    return <Link href={`/report/${json.report}`}>View Report</Link>;
  }

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
        <ReactDiffViewer
          oldValue={JSON.stringify(json.pre || {}, null, 2)}
          newValue={JSON.stringify(json.post || {}, null, 2)}
          compareMethod={DiffMethod.LINES}
          styles={COMPACT_DIFF_STYLES}
        />
      </div>
    );
  }

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

function RawAuditRow({
  event,
  open,
  setOpen,
}: {
  event: AuditInterface;
  open: boolean;
  setOpen: (open: boolean) => void;
}) {
  const user = event.user;
  const userDisplay =
    ("name" in user && user.name) ||
    ("email" in user && user.email) ||
    ("apiKey" in user && "API Key") ||
    ("system" in user && "System");

  return (
    <>
      <tr
        style={{ cursor: event.details ? "pointer" : "" }}
        className={open ? "highlight" : event.details ? "hover-highlight" : ""}
        onClick={() => {
          if (event.details) setOpen(!open);
        }}
      >
        <td title={datetime(event.dateCreated)}>
          {datetime(event.dateCreated)}
        </td>
        <td>{userDisplay}</td>
        <td>{event.event}</td>
        <td style={{ width: 30 }}>
          {event.details && (open ? <FaAngleUp /> : <FaAngleDown />)}
        </td>
      </tr>
      {open && event.details && (
        <tr>
          <td colSpan={4} className="bg-light" style={{ padding: "12px 16px" }}>
            <EventDetails
              eventType={event.event}
              details={event.details}
              reason={event.reason}
            />
          </td>
        </tr>
      )}
    </>
  );
}

function RawAuditLogTab<T>({
  auditEntries,
}: {
  auditEntries: UseAuditEntriesResult<T>;
}) {
  const {
    allAuditEvents,
    loading,
    refreshing,
    hasMore,
    total,
    loadMore,
    refresh,
  } = auditEntries;
  const [openId, setOpenId] = useState<string>("");
  const [currentPage, setCurrentPage] = useState(1);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_LIMIT));
  const pageStart = (currentPage - 1) * PAGE_LIMIT;
  const pageEvents = allAuditEvents.slice(pageStart, pageStart + PAGE_LIMIT);

  const goToPage = (page: number) => {
    setCurrentPage(page);
    setOpenId("");
    // If this page's data isn't loaded yet, fetch it
    if (allAuditEvents.length < page * PAGE_LIMIT && hasMore) {
      loadMore();
    }
  };

  const isPageLoading = pageEvents.length === 0 && loading;

  return (
    <Box>
      <Flex align="center" gap="3" mb="3">
        <Heading as="h5" size="medium">
          Audit Log
        </Heading>
        <Text size="small" color="text-low">
          {total} total event{total !== 1 ? "s" : ""}
        </Text>
        <Box ml="auto">
          <Button
            variant="ghost"
            size="xs"
            disabled={refreshing}
            onClick={async () => {
              await refresh();
              setCurrentPage(1);
            }}
          >
            <PiArrowsClockwise /> refresh
          </Button>
        </Box>
      </Flex>
      <table className="table appbox">
        <thead>
          <tr>
            <th>Date</th>
            <th>User</th>
            <th>Event</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {isPageLoading ? (
            <tr>
              <td
                colSpan={4}
                style={{
                  textAlign: "center",
                  color: "var(--gray-11)",
                  padding: "12px",
                }}
              >
                Loading…
              </td>
            </tr>
          ) : (
            pageEvents.map((event) => (
              <RawAuditRow
                key={event.id}
                event={event}
                open={openId === event.id}
                setOpen={(open) => setOpenId(open ? event.id : "")}
              />
            ))
          )}
        </tbody>
      </table>
      {totalPages > 1 && (
        <Flex justify="between" align="center" mt="3">
          <span style={{ fontSize: 13 }}>
            Page {currentPage} of {totalPages}
          </span>
          <Flex gap="2">
            <Button
              variant="outline"
              disabled={currentPage <= 1}
              onClick={() => goToPage(currentPage - 1)}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              disabled={currentPage >= totalPages || isPageLoading}
              onClick={() => goToPage(currentPage + 1)}
            >
              {isPageLoading ? "Loading…" : "Next"}
            </Button>
          </Flex>
        </Flex>
      )}
    </Box>
  );
}

// ---- Outer Modal ----

export interface AuditHistoryExplorerModalProps<T> {
  entityId: string;
  entityName: string;
  config: AuditDiffConfig<T>;
  eventLabels?: Record<string, string>;
  onClose: () => void;
}

export default function AuditHistoryExplorerModal<T>({
  entityId,
  entityName,
  config,
  eventLabels = {},
  onClose,
}: AuditHistoryExplorerModalProps<T>) {
  const auditEntries = useAuditEntries<T>(config, entityId);

  return (
    <Modal
      trackingEventModalType="audit-history-explorer"
      open={true}
      header={`${entityName} Audit History`}
      close={onClose}
      hideCta
      includeCloseCta
      closeCta="Close"
      size="max"
      sizeY="max"
      bodyClassName="p-0"
    >
      <Tabs
        defaultValue="explore"
        style={{ display: "flex", flexDirection: "column", height: "100%" }}
      >
        <Box
          px="3"
          pt="2"
          style={{
            borderBottom: "1px solid var(--gray-5)",
            flexShrink: 0,
            boxShadow:
              "0 1px 2px rgba(0, 0, 0, 0.1), 0 4px 4px rgba(0, 0, 0, 0.025)",
          }}
        >
          <TabsList style={{ boxShadow: "none" }}>
            <TabsTrigger value="explore">Explore Changes</TabsTrigger>
            <TabsTrigger value="raw">Audit Log</TabsTrigger>
          </TabsList>
        </Box>
        <TabsContent
          value="explore"
          style={{
            flex: 1,
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
          }}
        >
          <Flex style={{ flex: 1, minHeight: 0 }}>
            <CompareAuditEvents<T>
              config={config}
              auditEntries={auditEntries}
              eventLabels={eventLabels}
            />
          </Flex>
        </TabsContent>
        <TabsContent
          value="raw"
          style={{ flex: 1, overflow: "auto", padding: "16px" }}
        >
          <RawAuditLogTab<T> auditEntries={auditEntries} />
        </TabsContent>
      </Tabs>
    </Modal>
  );
}
