import { FC, useState } from "react";
import AsyncQueriesModal from "./AsyncQueriesModal";
import clsx from "clsx";
import { FaDatabase } from "react-icons/fa";

const ViewAsyncQueriesButton: FC<{
  queries: string[];
  display?: string;
  color?: string;
}> = ({ queries, display = "View Queries", color = "link" }) => {
  const [open, setOpen] = useState(false);

  return (
    <>
      {open && queries.length > 0 && (
        <AsyncQueriesModal close={() => setOpen(false)} queries={queries} />
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
        <FaDatabase /> {display}{" "}
        {queries.length > 0 ? `(${queries.length})` : ""}
      </button>
    </>
  );
};
export default ViewAsyncQueriesButton;
