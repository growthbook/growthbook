import { FC, ReactNode, useState } from "react";
import clsx from "clsx";
import { FaDatabase } from "react-icons/fa";
import { QueryStatus } from "back-end/types/query";
import Tooltip from "@/components/Tooltip/Tooltip";
import AsyncQueriesModal from "./AsyncQueriesModal";

const ViewAsyncQueriesButton: FC<{
  queries: string[];
  error?: string;
  display?: string | JSX.Element | null;
  color?: string;
  className?: string;
  inline?: boolean;
  ctaCommponent?: (onClick: () => void) => ReactNode;
  condensed?: boolean;
  icon?: JSX.Element | string | null;
  status?: QueryStatus;
}> = ({
  queries,
  display = "View Queries",
  color = "link",
  error,
  className = "",
  inline = false,
  ctaCommponent,
  condensed = false,
  icon,
  status,
}) => {
  const [open, setOpen] = useState(false);

  if (!className)
    className = condensed ? `btn btn-${color} border-0` : `btn btn-${color}`;

  return (
    <>
      {ctaCommponent ? (
        ctaCommponent(() => {
          if (!queries.length) return;
          setOpen(!open);
        })
      ) : (
        <Tooltip
          body={
            queries.length > 0
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
            status ?? ""
          )}
        >
          <button
            className={clsx(className, {
              disabled: queries.length === 0,
              "pl-2 pr-1 py-0 d-flex align-items-center": condensed,
            })}
            style={{
              ...(queries.length === 0 ? { cursor: "not-allowed" } : {}),
              ...(condensed ? { height: 35 } : {}),
            }}
            type="button"
            onClick={(e) => {
              e.preventDefault();
              if (!queries.length) return;
              setOpen(!open);
            }}
          >
            <span
              className={clsx("h4", {
                "position-relative d-flex m-0 d-inline-block align-top pr-3": condensed,
                "pr-2": !condensed,
              })}
            >
              {icon !== undefined ? icon : <FaDatabase />}
            </span>{" "}
            {display}
            {queries.length > 0 ? (
              condensed ? (
                <div
                  className="d-inline-block position-absolute"
                  style={{
                    right: 12,
                    top: -1,
                  }}
                >
                  {queries.length}
                </div>
              ) : (
                <div className="d-inline-block ml-1">({queries.length})</div>
              )
            ) : null}
          </button>
        </Tooltip>
      )}
      {open && queries.length > 0 && (
        <AsyncQueriesModal
          close={() => setOpen(false)}
          queries={queries}
          error={error}
          inline={inline}
        />
      )}
    </>
  );
};
export default ViewAsyncQueriesButton;
