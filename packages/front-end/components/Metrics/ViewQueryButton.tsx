import { FC, useState } from "react";
import { QueryLanguage } from "shared/types/datasource";
import QueryModal from "@/components/Experiment/QueryModal";

const ViewQueryButton: FC<{
  language: QueryLanguage;
  queries: string[];
  display?: string;
}> = ({ language, queries, display = "View Queries" }) => {
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
        {display} ({language})
      </button>
    </>
  );
};
export default ViewQueryButton;
