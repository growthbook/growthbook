import { FC, useEffect, useState } from "react";
import NewExperimentForm from "./NewExperimentForm";
import SelectField from "../Forms/SelectField";
import ImportExperimentList from "./ImportExperimentList";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import Modal from "../Modal";
import { useDefinitions } from "../../services/DefinitionsContext";
import { useAuth } from "../../services/auth";

const ImportExperimentModal: FC<{
  onClose: () => void;
  initialValue?: Partial<ExperimentInterfaceStringDates>;
  importMode?: boolean;
  source?: string;
}> = ({ onClose, initialValue, importMode = true, source }) => {
  const { datasources } = useDefinitions();
  const [
    selected,
    setSelected,
  ] = useState<null | Partial<ExperimentInterfaceStringDates>>(initialValue);
  const [importModal, setImportModal] = useState<boolean>(importMode);
  const [datasourceId, setDatasourceId] = useState(datasources?.[0]?.id);
  const [importId, setImportId] = useState(null);

  const { apiCall } = useAuth();

  const getImportId = async () => {
    if (datasourceId) {
      const res = await apiCall<{ id: string }>("/experiments/import", {
        method: "POST",
        body: JSON.stringify({
          datasource: datasourceId,
        }),
      });
      if (res?.id) {
        setImportId(res.id);
      }
    }
  };
  useEffect(() => {
    getImportId();
  }, [datasourceId]);

  if (selected || !importModal || !datasourceId) {
    return (
      <NewExperimentForm
        initialValue={selected}
        onClose={() => onClose()}
        source={source}
        isImport={!!selected}
      />
    );
  }

  return (
    <Modal
      header="Import Experiment"
      open={true}
      size="lg"
      close={() => onClose()}
    >
      <a
        className="cursor-pointer float-right"
        onClick={(e) => {
          e.preventDefault();
          setImportModal(false);
        }}
      >
        Create experiment
      </a>
      {datasources.length > 1 && (
        <SelectField
          label="Import from data source:"
          value={datasourceId}
          options={datasources.map((d) => ({
            value: d.id,
            label: d.name,
          }))}
          onChange={setDatasourceId}
        />
      )}
      {importId && (
        <ImportExperimentList
          onImport={(create) => {
            setSelected(create);
          }}
          importId={importId}
        />
      )}
    </Modal>
  );
};
export default ImportExperimentModal;
