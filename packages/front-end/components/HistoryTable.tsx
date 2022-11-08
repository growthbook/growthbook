import { FC, useState, useMemo } from "react";
import useApi from "../hooks/useApi";
import LoadingOverlay from "./LoadingOverlay";
import { AuditInterface, EventType } from "back-end/types/audit";
import { ago, datetime } from "../services/dates";
import Code from "./SyntaxHighlighting/Code";
import Link from "next/link";
import ReactDiffViewer, { DiffMethod } from "react-diff-viewer";
import Button from "./Button";
import { BsArrowRepeat } from "react-icons/bs";
import { FaAngleDown, FaAngleUp } from "react-icons/fa";

function EventDetails({
  eventType,
  details,
}: {
  eventType: EventType;
  details: string;
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
  return <Code language="json" code={JSON.stringify(json, null, 2)} />;
}

export function HistoryTableRow({
  event,
  open,
  setOpen,
  isActivity = false,
  itemName = "",
  url = "",
}: {
  event: AuditInterface;
  open: boolean;
  setOpen: (open: boolean) => void;
  isActivity?: boolean;
  itemName?: string;
  url?: string;
}) {
  itemName = itemName || event.entity.id;
  const user = event.user;
  const userDisplay =
    ("name" in user && user.name) ||
    ("email" in user && user.email) ||
    ("apiKey" in user && "API Key");
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
        {isActivity && (
          <>
            <td>{event.entity.object}</td>
            <td>
              <Link href={url}>
                <a>{itemName}</a>
              </Link>
            </td>
          </>
        )}
        <td>{userDisplay}</td>
        <td>{event.event}</td>
        <td style={{ width: 30 }}>
          {event.details && (open ? <FaAngleUp /> : <FaAngleDown />)}
        </td>
      </tr>
      {open && event.details && (
        <tr>
          <td colSpan={isActivity ? 6 : 4} className="bg-light p-3">
            <EventDetails eventType={event.event} details={event.details} />
          </td>
        </tr>
      )}
    </>
  );
}

const HistoryTable: FC<{
  type: "experiment" | "metric" | "feature";
  id: string;
}> = ({ id, type }) => {
  const { data, error, mutate } = useApi<{ events: AuditInterface[] }>(
    `/history/${type}/${id}`
  );

  const [open, setOpen] = useState("");

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
            <th>User</th>
            <th>Event</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {data.events.map((event) => (
            <HistoryTableRow
              event={event}
              key={event.id}
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
