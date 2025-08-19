import { FC } from "react";
import { ago, datetime } from "shared/dates";

const QueriesNextRun: FC<{
  scheduledDate: Date | undefined;
}> = ({ scheduledDate }) => {
  return (
    <div
      className="text-muted text-left"
      style={{ maxWidth: 130, fontSize: "0.8em" }}
    >
      <div className="font-weight-bold" style={{ lineHeight: 1.2 }}>
        next scheduled
      </div>
      <div className="d-flex align-items-center">
        <div style={{ lineHeight: 1 }} title={datetime(scheduledDate ?? "")}>
          {ago(scheduledDate ?? "")}
        </div>
      </div>
    </div>
  );
};
export default QueriesNextRun;
