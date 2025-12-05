import { FC, ReactNode, useState } from "react";
import clsx from "clsx";
import { FaDatabase } from "react-icons/fa";
import { QueryStatus } from "back-end/types/query";
import Tooltip from "@/components/Tooltip/Tooltip";
import AsyncQueriesModal from "./AsyncQueriesModal";

const ViewAsyncQueriesButton: FC<{
  queries: string[];
  savedQueries?: string[];
  error?: string;
  display?: string | JSX.Element | null;
  color?: string;
  className?: string;
  inline?: boolean;
  ctaComponent?: (onClick: () => void) => ReactNode;
  condensed?: boolean;
  icon?: JSX.Element | string | null;
  status?: QueryStatus;
  hideQueryCount?: boolean;
}> = ({
  queries,
  savedQueries = [],
  display = "View Queries",
  color = "link",
  error,
  className = "",
  inline = false,
  ctaComponent,
  condensed = false,
  icon,
  status,
  hideQueryCount,
}) => {
  const [open, setOpen] = useState(false);
  const totalQueries = queries.length + savedQueries.length;

  if (!className)
    className = condensed ? `btn btn-${color} border-0` : `btn btn-${color}`;

  return (
    <>
      {ctaComponent ? (
        ctaComponent(() => {
          if (totalQueries === 0) return;
          setOpen(!open);
        })
      ) : (
        <Tooltip
          body={
            totalQueries > 0
              ? status
                ? status === "running"
                  ? "View running queries"
                  : status === "failed"
                    ? "View failed queries"
                    : status === "partially-succeeded"
                      ? "View failed queries"
                      : ""
                : ""
              : "No queries were run"
          }
          shouldDisplay={["running", "failed", "partially-succeeded"].includes(
            status ?? "",
          )}
        >
          <button
            className={clsx("position-relative", className, {
              disabled: totalQueries === 0,
              "d-flex align-items-center": condensed,
            })}
            style={{
              ...(totalQueries === 0 ? { cursor: "not-allowed" } : {}),
            }}
            type="button"
            onClick={(e) => {
              e.preventDefault();
              if (totalQueries === 0) return;
              setOpen(!open);
            }}
          >
            {icon !== null && (
              <span
                className={clsx("h4", {
                  "position-relative d-flex m-0 d-inline-block align-top":
                    condensed,
                  "pr-2": !hideQueryCount,
                })}
              >
                {icon !== undefined ? icon : <FaDatabase />}
              </span>
            )}
            {display}
            {!hideQueryCount ? (
              <>
                {totalQueries > 0 ? (
                  condensed ? (
                    <div
                      className="d-inline-block position-absolute"
                      style={{
                        right: 12,
                        top: -1,
                      }}
                    >
                      {totalQueries}
                    </div>
                  ) : (
                    <div className="d-inline-block ml-1">({totalQueries})</div>
                  )
                ) : null}
              </>
            ) : null}
          </button>
        </Tooltip>
      )}
      {open && totalQueries > 0 && (
        <AsyncQueriesModal
          close={() => setOpen(false)}
          queries={queries}
          savedQueries={savedQueries}
          error={error}
          inline={inline}
        />
      )}
    </>
  );
};
export default ViewAsyncQueriesButton;
