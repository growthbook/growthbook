import { FC, useState } from "react";
import { AuditInterface } from "back-end/types/audit";
import useApi from "@/hooks/useApi";
import LoadingOverlay from "@/components/LoadingOverlay";
import { HistoryTableRow } from "@/components/HistoryTable";
import track from "@/services/track";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableColumnHeader,
  TableCell,
} from "@/ui/Table";

const Activity: FC = () => {
  const { data, error } = useApi<{
    events: AuditInterface[];
    experiments: { id: string; name: string }[];
  }>("/activity");

  track("Viewed Activity Page");

  const [open, setOpen] = useState("");

  if (error) {
    return <div className="alert alert-danger">{error.message}</div>;
  }
  if (!data) {
    return <LoadingOverlay />;
  }

  const nameMap = new Map<string, string>();
  data.experiments.forEach((e) => {
    nameMap.set(e.id, e.name);
  });

  return (
    <div className="container-fluid">
      <h3>Activity - Last 7 Days</h3>
      <p>Includes all watched features and experiments.</p>
      {data.events.length > 0 ? (
        <Table variant="standard" className="appbox">
          <thead>
            <tr>
              <th>Date</TableColumnHeader>
              <th>Type</TableColumnHeader>
              <th>Name</TableColumnHeader>
              <th>User</TableColumnHeader>
              <th>Event</TableColumnHeader>
              <th></TableColumnHeader>
            </TableRow>
          </TableHeader>
          <tbody>
            {data.events.map((event) => (
              <HistoryTableRow
                event={event}
                key={event.id}
                open={open === event.id}
                setOpen={(open) => {
                  setOpen(open ? event.id : "");
                }}
                showName={true}
                showType={true}
                itemName={
                  nameMap.has(event.entity.id)
                    ? nameMap.get(event.entity.id)
                    : undefined
                }
                url={
                  event.entity.object === "feature"
                    ? `/features/${event.entity.id}`
                    : `/${event.entity.object}/${event.entity.id}`
                }
              />
            ))}
          </TableBody>
        </Table>
      ) : (
        <p>
          <em>No recent events</em>
        </p>
      )}
    </div>
  );
};

export default Activity;
