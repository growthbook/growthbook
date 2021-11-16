import { FC, useState } from "react";
import AsyncQueriesModal from "./AsyncQueriesModal";
import clsx from "clsx";
import { FaDatabase } from "react-icons/fa";

const ViewAsyncQueriesButton: FC<{
  queries: string[];
  error?: string;
  display?: string;
  color?: string;
}> = ({ queries, display = "View Queries", color = "link", error }) => {
  const [open, setOpen] = useState(false);

  return (
    <>
      {open && queries.length > 0 && (
        <AsyncQueriesModal
          close={() => setOpen(false)}
          queries={queries}
          error={error}
        />
      )}
      <button
        className={clsx("btn", `btn-${color}`, {
          disabled: queries.length === 0,
        })}
        onClick={(e) => {
          e.preventDefault();
          if (!queries.length) return;
          setOpen(true);
        }}
      >
        <span className="h4 pr-2 m-0 d-inline-block align-top">
          <FaDatabase />
        </span>{" "}
        {display} {queries.length > 0 ? `(${queries.length})` : ""}
      </button>
    </>
  );
};
export default ViewAsyncQueriesButton;
