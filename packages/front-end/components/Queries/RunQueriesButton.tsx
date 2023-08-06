import { FC, ReactElement, useEffect, useState } from "react";
import { QueryStatus, Queries } from "back-end/types/query";
import clsx from "clsx";
import { FaPlay } from "react-icons/fa";
import { BsArrowRepeat } from "react-icons/bs";
import { getValidDate } from "shared/dates";
import { useAuth } from "@/services/auth";
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
  cancelEndpoint: string;
  model: { queries: Queries; runStarted: string | Date | undefined | null };
  mutate: () => Promise<unknown> | unknown;
  icon?: "run" | "refresh";
  color?: string;
  position?: "left" | "right";
}> = ({
  cta = "Run Queries",
  loadingText = "Running",
  cancelEndpoint,
  model,
  mutate,
  icon = "run",
  color = "primary",
  position = "right",
}) => {
  const { apiCall } = useAuth();

  const startTime = model.runStarted
    ? getValidDate(model.runStarted).getTime()
    : null;
  const elapsed = startTime ? Math.floor((Date.now() - startTime) / 1000) : 0;

  // Used to refresh this component while query is running so we can show an elapsed timer
  // eslint-disable-next-line
  const [_, setCounter] = useState(0);

  const numFinished = model.queries.filter((q) => q.status === "succeeded")
    .length;
  const numQueries = model.queries.length;

  const status = getQueryStatus(model.queries || []);
  const timeoutLength = getTimeoutLength(elapsed);

  // Mutate periodically to check for updates
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

  // While query is running, refresh this component frequently to show an elapsed timer
  useEffect(() => {
    if (status !== "running") return;

    const timer = window.setInterval(() => {
      setCounter((count) => count + 1);
    }, 500);

    return () => window.clearInterval(timer);
  }, [status]);

  let buttonIcon: ReactElement;
  if (status === "running") {
    buttonIcon = <LoadingSpinner />;
  } else if (icon === "refresh") {
    buttonIcon = <BsArrowRepeat />;
  } else {
    buttonIcon = <FaPlay />;
  }

  return (
    <>
      <div
        className={`d-flex ${
          position === "right" ? "justify-content-end" : "justify-content-start"
        }`}
      >
        {status === "running" && (
          <div>
            <button
              className="btn btn-link text-danger"
              onClick={async (e) => {
                e.preventDefault();
                await apiCall(cancelEndpoint, { method: "POST" });
                await mutate();
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
              ? `${loadingText} (${getTimeDisplay(elapsed)})...`
              : cta}
          </button>
          {status === "running" && numQueries > 0 && (
            <div
              style={{
                width: Math.floor((100 * numFinished) / numQueries) + "%",
                height: 5,
              }}
              className="bg-info"
            />
          )}
        </div>
      </div>
    </>
  );
};
export default RunQueriesButton;
