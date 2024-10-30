import { FC } from "react";
import { FaExclamationTriangle } from "react-icons/fa";
import { ago, datetime } from "shared/dates";
import Tooltip from "@/components/Tooltip/Tooltip";

const PARTIALLY_SUCCEEDED_STRING = `Some of the queries had an error. The partial results
                are displayed below.`;

const QueriesLastRun: FC<{
  status;
  dateCreated: Date | undefined;
  partiallySucceededString?: string;
}> = ({
  status,
  dateCreated,
  partiallySucceededString = PARTIALLY_SUCCEEDED_STRING,
}) => {
  return (
    <div
      className="text-muted text-right"
      style={{ maxWidth: 130, fontSize: "0.8em" }}
    >
      <div className="font-weight-bold" style={{ lineHeight: 1.2 }}>
        last updated
        {status === "partially-succeeded" && (
          <Tooltip
            body={
              <div className="text-left">
                <span style={{ lineHeight: 1.5 }}>
                  {partiallySucceededString}
                </span>
              </div>
            }
          >
            <FaExclamationTriangle
              size={14}
              className="text-danger ml-1"
              style={{ marginTop: -4 }}
            />
          </Tooltip>
        )}
      </div>
      <div className="d-flex align-items-center">
        <div style={{ lineHeight: 1 }} title={datetime(dateCreated ?? "")}>
          {ago(dateCreated ?? "")}
        </div>
      </div>
    </div>
  );
};
export default QueriesLastRun;
