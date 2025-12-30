import {
  ForwardedRef,
  forwardRef,
  ReactElement,
  useEffect,
  useState,
} from "react";
import { QueryStatus, Queries } from "shared/types/query";
import clsx from "clsx";
import { FaPlay } from "react-icons/fa";
import { BsArrowRepeat } from "react-icons/bs";
import { getValidDate } from "shared/dates";
import { FaXmark } from "react-icons/fa6";
import { useAuth } from "@/services/auth";
import LoadingSpinner from "@/components/LoadingSpinner";
import Button from "@/ui/Button";

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

export interface QueryStatusData {
  status: QueryStatus;
  numFailed?: number;
  failedNames?: string[];
}
export function getQueryStatus(
  queries: Queries,
  error?: string | null,
): QueryStatusData {
  let status: QueryStatus = "succeeded";
  let numFailed = 0;
  const failedNames: string[] = [];

  if (error) status = "failed";
  let running = false;
  for (let i = 0; i < queries.length; i++) {
    if (queries[i].status === "failed") {
      failedNames.push(queries[i].name);
      numFailed++;
    }
    if (queries[i].status === "running" || queries[i].status === "queued")
      running = true;
  }

  if (numFailed > 0) status = "partially-succeeded";
  if (queries.length > 0 && numFailed >= queries.length / 2) status = "failed";
  if (running) status = "running";
  return { status, numFailed, failedNames };
}

type Props = {
  cta?: string;
  loadingText?: string;
  cancelEndpoint: string;
  model: { queries: Queries; runStarted: string | Date | undefined | null };
  mutate: () => Promise<unknown> | unknown;
  icon?: "run" | "refresh";
  color?: string;
  position?: "left" | "right";
  resetFilters?: () => void | Promise<void>;
  onSubmit?: () => void | Promise<void>;
  disabled?: boolean;
  useRadixButton?: boolean;
};

const RunQueriesButton = forwardRef<HTMLButtonElement, Props>(
  (
    {
      cta = "Run Queries",
      loadingText = "Running",
      cancelEndpoint,
      model,
      mutate,
      icon = "run",
      color = "primary",
      position = "right",
      resetFilters,
      onSubmit,
      disabled,
      useRadixButton,
    },
    ref: ForwardedRef<HTMLButtonElement>,
  ) => {
    const { apiCall } = useAuth();

    const startTime = model.runStarted
      ? getValidDate(model.runStarted).getTime()
      : null;
    const elapsed = startTime ? Math.floor((Date.now() - startTime) / 1000) : 0;

    // Used to refresh this component while query is running so we can show an elapsed timer
    // eslint-disable-next-line
    const [_, setCounter] = useState(0);

    const numFinished = model.queries.filter(
      (q) => q.status === "succeeded",
    ).length;
    const numQueries = model.queries.length;

    const { status } = getQueryStatus(model.queries || []);
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
            position === "right"
              ? "justify-content-end"
              : "justify-content-start"
          }`}
        >
          {status === "running" && (
            <div
              className="btn btn-danger p-0 position-absolute text-center"
              style={{
                zIndex: 1,
                width: 22,
                height: 22,
                right: 0,
                top: -10,
                borderRadius: 50,
              }}
              onClick={async () => {
                resetFilters?.();
                try {
                  await apiCall(cancelEndpoint, { method: "POST" });
                } catch (e) {
                  console.error(e);
                }
                await mutate();
              }}
              title="Cancel"
            >
              <FaXmark size={14} style={{ marginTop: -3.5 }} />
            </div>
          )}
          <div className="position-relative">
            {useRadixButton ? (
              <Button
                ref={ref}
                variant="soft"
                size="sm"
                ml="2"
                disabled={status === "running" || disabled}
                type="button"
                onClick={async () => {
                  await resetFilters?.();
                  await onSubmit?.();
                }}
                icon={buttonIcon}
              >
                {status === "running"
                  ? `${loadingText} (${getTimeDisplay(elapsed)})...`
                  : cta}
              </Button>
            ) : (
              <button
                ref={ref}
                className={clsx("btn font-weight-bold my-0", `btn-${color}`, {
                  disabled: status === "running",
                })}
                disabled={status === "running" || disabled}
                type="submit"
                onClick={async () => {
                  await resetFilters?.();
                  await onSubmit?.();
                }}
              >
                <span className="h4 pr-2 m-0 d-inline-block align-top">
                  {buttonIcon}
                </span>
                {status === "running"
                  ? `${loadingText} (${getTimeDisplay(elapsed)})...`
                  : cta}
              </button>
            )}
            {status === "running" && numQueries > 0 && (
              <div
                className="position-absolute bg-info"
                style={{
                  width: Math.floor((100 * numFinished) / numQueries) + "%",
                  height: 4,
                }}
              />
            )}
          </div>
        </div>
      </>
    );
  },
);
RunQueriesButton.displayName = "RunQueriesButton";
export default RunQueriesButton;
