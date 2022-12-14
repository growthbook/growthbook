import { FC, useEffect, useState } from "react";
import { QueryStatus, Queries } from "back-end/types/query";
import clsx from "clsx";
import { FaPlay } from "react-icons/fa";
import { BsArrowRepeat } from "react-icons/bs";
import { useAuth } from "@/services/auth";
import useApi from "@/hooks/useApi";
import LoadingSpinner from "../LoadingSpinner";

function getTimeDisplay(seconds: number): string {
  if (seconds < 120) {
    return seconds + "s";
  }
  if (seconds < 3600) {
    return Math.floor(seconds / 60) + "m";
  }
  return Math.floor(seconds / 3600) + "h";
}

function getTimeoutLength(seconds: number): number {
  if (seconds < 10) return 2000;
  if (seconds < 30) return 3000;
  if (seconds < 60) return 5000;
  if (seconds < 300) return 10000;
  if (seconds < 600) return 20000;
  return 0;
}

export function getQueryStatus(queries: Queries, error?: string): QueryStatus {
  if (error) return "failed";

  let running = false;
  for (let i = 0; i < queries.length; i++) {
    if (queries[i].status === "failed") return "failed";
    if (queries[i].status === "running") running = true;
  }
  return running ? "running" : "succeeded";
}

const RunQueriesButton: FC<{
  cta?: string;
  loadingText?: string;
  statusEndpoint: string;
  cancelEndpoint: string;
  initialStatus: QueryStatus;
  icon?: "run" | "refresh";
  onReady: () => void;
  color?: string;
}> = ({
  cta = "Run Queries",
  loadingText = "Running",
  statusEndpoint,
  cancelEndpoint,
  initialStatus,
  onReady,
  icon = "run",
  color = "primary",
}) => {
  const { data, error, mutate } = useApi<{
    queryStatus: QueryStatus;
    finished: number;
    total: number;
    elapsed: number;
  }>(statusEndpoint);

  const { apiCall } = useAuth();

  const [counter, setCounter] = useState(0);

  const status = data?.queryStatus || initialStatus;

  const timeoutLength = getTimeoutLength(data?.elapsed || 0);

  useEffect(() => {
    mutate();
  }, [initialStatus]);

  useEffect(() => {
    if (status !== "running") return;
    if (!timeoutLength) return;

    let timer = 0;
    const loop = async () => {
      await mutate();
      if (timer === -1) return;
      timer = window.setTimeout(loop, timeoutLength);
    };
    timer = window.setTimeout(loop, timeoutLength);
    return () => {
      window.clearTimeout(timer);
      timer = -1;
    };
  }, [status, timeoutLength]);

  useEffect(() => {
    if (status === "succeeded") {
      onReady();
    }
    if (status === "failed") {
      onReady();
    }
  }, [status]);

  useEffect(() => {
    if (status !== "running") return;

    const timer = window.setInterval(() => {
      setCounter((count) => {
        return count + 1;
      });
    }, 1000);

    return () => {
      window.clearInterval(timer);
    };
  }, [status]);

  useEffect(() => {
    setCounter(data?.elapsed || 0);
  }, [data?.elapsed]);

  let buttonIcon: React.ReactElement;
  if (status === "running") {
    buttonIcon = <LoadingSpinner />;
  } else if (icon === "refresh") {
    buttonIcon = <BsArrowRepeat />;
  } else {
    buttonIcon = <FaPlay />;
  }

  return (
    <>
      <div className="d-flex justify-content-end">
        {status === "running" && (
          <div>
            <button
              className="btn btn-link text-danger"
              onClick={async (e) => {
                e.preventDefault();
                await apiCall(cancelEndpoint, { method: "POST" });
                onReady();
              }}
            >
              cancel
            </button>
          </div>
        )}
        <div>
          <button
            className={clsx("btn font-weight-bold", `btn-${color}`, {
              disabled: status === "running",
            })}
            type="submit"
          >
            <span className="h4 pr-2 m-0 d-inline-block align-top">
              {buttonIcon}
            </span>
            {status === "running"
              ? `${loadingText} (${getTimeDisplay(counter)})...`
              : cta}
          </button>
          {status === "running" && data?.total > 0 && (
            <div
              style={{
                width:
                  Math.floor((100 * (data?.finished || 0)) / data?.total) + "%",
                height: 5,
              }}
              className="bg-info"
            />
          )}
        </div>
      </div>
      {error && <div className="text-danger mt-2 mb-2">{error.message}</div>}
    </>
  );
};
export default RunQueriesButton;
