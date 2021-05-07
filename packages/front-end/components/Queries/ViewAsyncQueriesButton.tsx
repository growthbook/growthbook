import { FC, useState } from "react";
import AsyncQueriesModal from "./AsyncQueriesModal";
import clsx from "clsx";

const ViewAsyncQueriesButton: FC<{
  queries: string[];
}> = ({ queries }) => {
  const [open, setOpen] = useState(false);

  return (
    <>
      {open && queries.length > 0 && (
        <AsyncQueriesModal close={() => setOpen(false)} queries={queries} />
      )}
      <button
        className={clsx("btn btn-link", {
          disabled: queries.length === 0,
        })}
        onClick={(e) => {
          e.preventDefault();
          if (!queries.length) return;
          setOpen(true);
        }}
      >
        View Queries {queries.length > 0 ? `(${queries.length})` : ""}
      </button>
    </>
  );
};
export default ViewAsyncQueriesButton;
