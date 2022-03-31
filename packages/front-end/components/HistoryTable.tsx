import { FC, useState } from "react";
import useApi from "../hooks/useApi";
import LoadingOverlay from "./LoadingOverlay";
import { AuditInterface, EventType } from "back-end/types/audit";
import { ago, datetime } from "../services/dates";
import Code from "./Code";
import Link from "next/link";
import { useMemo } from "react";
import ReactDiffViewer, { DiffMethod } from "react-diff-viewer";

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
                {json.context[k]}
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

function HistoryTableRow({ event }: { event: AuditInterface }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <tr onClick={() => setOpen(!open)} style={{ cursor: "pointer" }}>
        <td title={datetime(event.dateCreated)}>{ago(event.dateCreated)}</td>
        <td>{event.user.name || event.user.email}</td>
        <td>{event.event}</td>
      </tr>
      {open && (
        <tr>
          <td colSpan={3} className="bg-light">
            {event.details ? (
              <EventDetails eventType={event.event} details={event.details} />
            ) : (
              <em>No details</em>
            )}
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
  const { data, error } = useApi<{ events: AuditInterface[] }>(
    `/history/${type}/${id}`
  );

  if (error) {
    return <div className="alert alert-danger">{error.message}</div>;
  }
  if (!data) {
    return <LoadingOverlay />;
  }

  return (
    <>
      <h4>Audit Log</h4>
      <table className="table appbox table-hover">
        <thead>
          <tr>
            <th>Date</th>
            <th>User</th>
            <th>Event</th>
          </tr>
        </thead>
        <tbody>
          {data.events.map((event) => (
            <HistoryTableRow event={event} key={event.id} />
          ))}
        </tbody>
      </table>
    </>
  );
};

export default HistoryTable;
