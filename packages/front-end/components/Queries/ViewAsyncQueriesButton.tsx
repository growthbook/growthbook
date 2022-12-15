import { FC, useState } from "react";
import clsx from "clsx";
import { FaDatabase } from "react-icons/fa";
import AsyncQueriesModal from "./AsyncQueriesModal";

const ViewAsyncQueriesButton: FC<{
  queries: string[];
  error?: string;
  display?: string;
  color?: string;
  className?: string;
  inline?: boolean;
}> = ({
  queries,
  display = "View Queries",
  color = "link",
  error,
  className = "",
  inline = false,
}) => {
  const [open, setOpen] = useState(false);

  if (!className) className = `btn btn-${color}`;

  return (
    <>
      <button
        className={clsx(className, {
          disabled: queries.length === 0,
        })}
        type="button"
        onClick={(e) => {
          e.preventDefault();
          if (!queries.length) return;
          setOpen(!open);
        }}
      >
        <span className="h4 pr-2 m-0 d-inline-block align-top">
          <FaDatabase />
        </span>{" "}
        {open ? (
          "Hide Queries"
        ) : (
          <>
            {display} {queries.length > 0 ? `(${queries.length})` : ""}
          </>
        )}
      </button>
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
