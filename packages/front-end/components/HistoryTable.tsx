import { FC, useState, useMemo } from "react";
import { AuditInterface, EventType } from "back-end/types/audit";
import Link from "next/link";
import ReactDiffViewer, { DiffMethod } from "react-diff-viewer";
import { BsArrowRepeat } from "react-icons/bs";
import { FaAngleDown, FaAngleUp } from "react-icons/fa";
import { useDefinitions } from "../services/DefinitionsContext";
import { ago, datetime } from "../services/dates";
import useApi from "../hooks/useApi";
import Button from "./Button";
import Code from "./SyntaxHighlighting/Code";
import LoadingOverlay from "./LoadingOverlay";

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

  // Link to ad-hoc report
  if (eventType === "experiment.analysis" && json.report) {
    return (
      <Link href={`/report/${json.report}`}>
        <a>View Report</a>
      </Link>
    );
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
        <ReactDiffViewer
          oldValue={JSON.stringify(json.pre || {}, null, 2)}
          newValue={JSON.stringify(json.post || {}, null, 2)}
          compareMethod={DiffMethod.LINES}
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
}: {
  event: AuditInterface;
  open: boolean;
  setOpen: (open: boolean) => void;
  showName?: boolean;
  showType?: boolean;
  itemName?: string;
  url?: string;
}) {
  const user = event.user;
  const userDisplay =
    ("name" in user && user.name) ||
    ("email" in user && user.email) ||
    ("apiKey" in user && "API Key");
  let colSpanNum = 4;
  if (showName) colSpanNum++;
  if (showType) colSpanNum++;

  const displayName = itemName || event.entity.name || event.entity.id;

  return (
    <>
      <tr
        style={{ cursor: event.details ? "pointer" : "" }}
        className={open ? "highlight" : event.details ? "hover-highlight" : ""}
        onClick={(e) => {
          // Don't toggle the row's open state if a link was clicked
          const target = e.target as HTMLElement;
          if (target && target.closest("a")) {
            return;
          }

          setOpen(!open);
        }}
      >
        <td title={datetime(event.dateCreated)}>{ago(event.dateCreated)}</td>
        {showType && <td>{event.entity.object}</td>}
        {showName && (
          <td>{url ? <Link href={url}>{displayName}</Link> : displayName}</td>
        )}
        <td>{userDisplay}</td>
        <td>{event.event}</td>
        <td style={{ width: 30 }}>
          {event.details && (open ? <FaAngleUp /> : <FaAngleDown />)}
        </td>
      </tr>
      {open && event.details && (
        <tr>
          <td colSpan={colSpanNum} className="bg-light p-3">
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

const HistoryTable: FC<{
  type: "experiment" | "metric" | "feature" | "savedGroup";
  showName?: boolean;
  showType?: boolean;
  id?: string;
}> = ({ id, type, showName = false, showType = false }) => {
  const apiPath = id ? `/history/${type}/${id}` : `/history/${type}`;
  const { data, error, mutate } = useApi<{ events: AuditInterface[] }>(apiPath);

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

  if (error) {
    return <div className="alert alert-danger">{error.message}</div>;
  }
  if (!data) {
    return <LoadingOverlay />;
  }

  return (
    <>
      <div className="row align-items-center">
        <div className="col-auto">
          <h4>Audit Log</h4>
        </div>
        <div className="col-auto ml-auto">
          <Button
            color="link btn-sm"
            onClick={async () => {
              await mutate();
            }}
          >
            <BsArrowRepeat /> refresh
          </Button>
        </div>
      </div>
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
    </>
  );
};

export default HistoryTable;
