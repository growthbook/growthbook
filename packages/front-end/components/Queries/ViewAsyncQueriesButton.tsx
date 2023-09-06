import { FC, ReactNode, useState } from "react";
import clsx from "clsx";
import { FaDatabase } from "react-icons/fa";
import AsyncQueriesModal from "./AsyncQueriesModal";

const ViewAsyncQueriesButton: FC<{
  queries: string[];
  error?: string;
  display?: string | JSX.Element | null;
  color?: string;
  className?: string;
  inline?: boolean;
  ctaCommponent?: (onClick: () => void) => ReactNode;
  newUi?: boolean;
}> = ({
  queries,
  display = "View Queries",
  color = "link",
  error,
  className = "",
  inline = false,
  ctaCommponent,
  newUi = false,
}) => {
  const [open, setOpen] = useState(false);

  if (!className)
    className = newUi ? `btn btn-${color} border-0` : `btn btn-${color}`;

  return (
    <>
      {ctaCommponent ? (
        ctaCommponent(() => {
          if (!queries.length) return;
          setOpen(!open);
        })
      ) : (
        <button
          className={clsx(className, {
            disabled: queries.length === 0,
            "pl-2 pr-1 py-0 d-flex align-items-center": newUi,
          })}
          style={newUi ? { height: 35 } : {}}
          type="button"
          onClick={(e) => {
            e.preventDefault();
            if (!queries.length) return;
            setOpen(!open);
          }}
        >
          <span
            className={clsx("h4", {
              "position-relative d-flex m-0 d-inline-block align-top pr-3": newUi,
              "pr-2": !newUi,
            })}
          >
            <FaDatabase />
          </span>{" "}
          {display}
          {queries.length > 0 ? (
            newUi ? (
              <div
                className="d-inline-block position-absolute"
                style={{
                  right: 11,
                  top: 3,
                  width: 17,
                  height: 17,
                  borderRadius: 18,
                  border: "1px solid #dc3545",
                  textAlign: "center",
                  lineHeight: "15px",
                }}
              >
                {queries.length}
              </div>
            ) : (
              <div className="d-inline-block ml-1">({queries.length})</div>
            )
          ) : null}
        </button>
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
