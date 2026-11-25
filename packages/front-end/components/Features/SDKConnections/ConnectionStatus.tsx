import { ReactElement } from "react";
import { FaCheckCircle, FaExclamationTriangle } from "react-icons/fa";
import { teal, red } from "@radix-ui/colors";
import { Trans } from "@lingui/react/macro";
import Tooltip from "@/components/Tooltip/Tooltip";
import Callout from "@/ui/Callout";

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
            <FaCheckCircle /> <Trans>Connected</Trans>
          </span>
        </>
      ) : (
        <>
          {error ? (
            <>
              <span className="text-danger">
                <FaExclamationTriangle /> <Trans>error</Trans>
              </span>
              {errorTxt !== undefined && (
                <Tooltip
                  className="ml-1"
                  innerClassName="pb-1"
                  usePortal={true}
                  body={
                    <>
                      <div className="mb-2">
                        <Trans>
                          Encountered an error while trying to connect:
                        </Trans>
                      </div>
                      {errorTxt ? (
                        <Callout status="error" mt="2">
                          {errorTxt}
                        </Callout>
                      ) : (
                        <Callout status="error">
                          <em>
                            <Trans>Unknown error</Trans>
                          </em>
                        </Callout>
                      )}
                    </>
                  }
                />
              )}
            </>
          ) : (
            <span style={{ color: red.red11, fontWeight: 500, fontSize: 12 }}>
              <Trans>Not connected</Trans>
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
