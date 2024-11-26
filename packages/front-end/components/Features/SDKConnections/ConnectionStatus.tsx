import { ReactElement } from "react";
import {
  FaCheckCircle,
  FaExclamationTriangle,
  FaQuestionCircle,
} from "react-icons/fa";
import Tooltip from "@/components/Tooltip/Tooltip";

export default function ConnectionStatus({
  connected,
  error,
  errorTxt,
  refresh,
  canRefresh,
}: {
  connected: boolean;
  error?: boolean;
  errorTxt?: string;
  refresh?: ReactElement;
  canRefresh: boolean;
}) {
  return (
    <div
      className="mx-3 text-center"
      style={{ zIndex: 10, marginTop: -8, whiteSpace: "nowrap" }}
    >
      {connected ? (
        <>
          <span className="text-success">
            <FaCheckCircle /> connected
          </span>
        </>
      ) : (
        <>
          {error ? (
            <>
              <span className="text-danger">
                <FaExclamationTriangle /> error
              </span>
              {errorTxt !== undefined && (
                <Tooltip
                  className="ml-1"
                  innerClassName="pb-1"
                  usePortal={true}
                  body={
                    <>
                      <div className="mb-2">
                        Encountered an error while trying to connect:
                      </div>
                      {errorTxt ? (
                        <div className="alert alert-danger mt-2">
                          {errorTxt}
                        </div>
                      ) : (
                        <div className="alert alert-danger">
                          <em>Unknown error</em>
                        </div>
                      )}
                    </>
                  }
                />
              )}
            </>
          ) : (
            <span className="text-secondary">
              <FaQuestionCircle /> not connected
            </span>
          )}
        </>
      )}
      <div style={{ marginTop: 10, textAlign: "center" }}>
        {canRefresh && refresh ? refresh : <>&nbsp;</>}
      </div>
    </div>
  );
}
