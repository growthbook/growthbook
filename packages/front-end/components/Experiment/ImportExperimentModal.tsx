import { FC, useEffect, useState } from "react";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useAuth } from "@/services/auth";
import Modal from "../Modal";
import ImportExperimentList from "./ImportExperimentList";
import NewExperimentForm from "./NewExperimentForm";

const ImportExperimentModal: FC<{
  onClose: () => void;
  initialValue?: Partial<ExperimentInterfaceStringDates>;
  importMode?: boolean;
  source?: string;
  fromFeature?: boolean;
}> = ({
  onClose,
  initialValue,
  importMode = true,
  source,
  fromFeature = false,
}) => {
  const { datasources } = useDefinitions();
  const [
    selected,
    setSelected,
    // @ts-expect-error TS(2345) If you come across this, please fix it!: Argument of type 'Partial<ExperimentInterfaceStrin... Remove this comment to see the full error message
  ] = useState<null | Partial<ExperimentInterfaceStringDates>>(initialValue);
  const [importModal, setImportModal] = useState<boolean>(importMode);
  const [datasourceId, setDatasourceId] = useState(() => {
    if (!datasources) return null;
    return (
      // @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'.
      datasources.filter((d) => d.properties.pastExperiments)[0]?.id ?? null
    );
  });
  const [importId, setImportId] = useState(null);

  const { apiCall } = useAuth();

  const getImportId = async () => {
    if (datasourceId) {
      try {
        const res = await apiCall<{ id: string }>("/experiments/import", {
          method: "POST",
          body: JSON.stringify({
            datasource: datasourceId,
          }),
        });
        if (res?.id) {
          // @ts-expect-error TS(2345) If you come across this, please fix it!: Argument of type 'string' is not assignable to par... Remove this comment to see the full error message
          setImportId(res.id);
        }
      } catch (e) {
        console.error(e);
      }
    }
  };
  useEffect(() => {
    getImportId();
  }, [datasourceId]);

  if (selected || !importModal || !datasourceId) {
    return (
      <NewExperimentForm
        // @ts-expect-error TS(2322) If you come across this, please fix it!: Type 'Partial<ExperimentInterfaceStringDates> | nu... Remove this comment to see the full error message
        initialValue={selected}
        onClose={() => onClose()}
        // @ts-expect-error TS(2322) If you come across this, please fix it!: Type 'string | undefined' is not assignable to typ... Remove this comment to see the full error message
        source={source}
        isImport={!!selected}
        fromFeature={fromFeature}
      />
    );
  }

  return (
    <Modal
      header="Add Experiment"
      open={true}
      size="max"
      close={() => onClose()}
    >
      <div className="alert alert-info">
        Don&apos;t see your experiment listed below?{" "}
        <a
          href="#"
          className="alert-link"
          onClick={(e) => {
            e.preventDefault();
            setImportModal(false);
          }}
        >
          Create From Scratch
        </a>
      </div>
      <h2>Import from Data source</h2>
      {importId && (
        <ImportExperimentList
          onImport={(create) => {
            setSelected(create);
          }}
          changeDatasource={setDatasourceId}
          importId={importId}
        />
      )}
    </Modal>
  );
};
export default ImportExperimentModal;
