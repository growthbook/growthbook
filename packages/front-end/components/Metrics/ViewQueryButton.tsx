import { FC, useState } from "react";
import { QueryLanguage } from "back-end/types/datasource";
import QueryModal from "../Experiment/QueryModal";

const ViewQueryButton: FC<{ language: QueryLanguage; queries: string[] }> = ({
  language,
  queries,
}) => {
  const [open, setOpen] = useState(false);

  return (
    <>
      {open && (
        <QueryModal
          close={() => setOpen(false)}
          language={language}
          queries={queries}
        />
      )}
      <button
        className="btn btn-link"
        onClick={(e) => {
          e.preventDefault();
          setOpen(true);
        }}
      >
        View Queries ({language})
      </button>
    </>
  );
};
export default ViewQueryButton;
