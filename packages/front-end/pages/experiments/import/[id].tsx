import React, { FC, useState } from "react";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { useRouter } from "next/router";
import ImportExperimentList from "@/components/Experiment/ImportExperimentList";
import NewExperimentForm from "@/components/Experiment/NewExperimentForm";

const ImportPage: FC = () => {
  const [
    create,
    setCreate,
  ] = useState<null | Partial<ExperimentInterfaceStringDates>>(null);
  const router = useRouter();
  const { id } = router.query;
  const importId = Array.isArray(id) ? id[0] : id;

  return (
    <div className="container-fluid pagecontents p-3">
      {create && (
        <NewExperimentForm
          onClose={() => setCreate(null)}
          initialValue={create}
          onCreate={(id) => {
            router.push(`/experiment/${id}#results`);
          }}
          isImport={true}
          source="import"
        />
      )}
      <h2>Import Experiments</h2>
      <ImportExperimentList onImport={setCreate} importId={importId} />
    </div>
  );
};
export default ImportPage;
