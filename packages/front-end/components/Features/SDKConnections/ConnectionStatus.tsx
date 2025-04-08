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
            <FaCheckCircle /> 已连接
          </span>
        </>
      ) : (
        <>
          {error ? (
            <>
              <span className="text-danger">
                <FaExclamationTriangle /> 错误
              </span>
              {errorTxt !== undefined && (
                <Tooltip
                  className="ml-1"
                  innerClassName="pb-1"
                  usePortal={true}
                  body={
                    <>
                      <div className="mb-2">
                        尝试连接时遇到错误:
                      </div>
                      {errorTxt ? (
                        <div className="alert alert-danger mt-2">
                          {errorTxt}
                        </div>
                      ) : (
                        <div className="alert alert-danger">
                          <em>未知错误</em>
                        </div>
                      )}
                    </>
                  }
                />
              )}
            </>
          ) : (
            <span className="text-secondary">
              <FaQuestionCircle /> 未连接
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