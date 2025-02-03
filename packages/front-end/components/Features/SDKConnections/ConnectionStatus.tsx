import { ReactElement } from "react";
import { FaCheckCircle, FaExclamationTriangle } from "react-icons/fa";
import { teal, red } from "@radix-ui/colors";
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
      style={{ zIndex: 10, marginTop: -12, whiteSpace: "nowrap" }}
    >
      {connected ? (
        <>
          <span className="text-success" style={{ color: teal.teal11 }}>
            <FaCheckCircle /> Connected
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
            <span style={{ color: red.red11, fontWeight: 500, fontSize: 12 }}>
              Not connected
            </span>
          )}
        </>
      )}
      <div style={{ marginTop: 24, textAlign: "center" }}>
        {canRefresh && refresh ? refresh : <>&nbsp;</>}
      </div>
    </div>
  );
}
