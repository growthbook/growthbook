import { FC, useEffect, useState } from "react";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useAuth } from "@/services/auth";
import useOrgSettings from "@/hooks/useOrgSettings";
import Modal from "../Modal";
import ImportExperimentList from "./ImportExperimentList";
import NewExperimentForm from "./NewExperimentForm";

const ImportExperimentModal: FC<{
  onClose: () => void;
  initialValue?: Partial<ExperimentInterfaceStringDates>;
  importMode?: boolean;
  source: string;
  fromFeature?: boolean;
}> = ({
  onClose,
  initialValue,
  importMode = true,
  source,
  fromFeature = false,
}) => {
  const settings = useOrgSettings();
  const { datasources } = useDefinitions();
  const [
    selected,
    setSelected,
  ] = useState<null | Partial<ExperimentInterfaceStringDates>>(
    initialValue ?? null
  );
  const [importModal, setImportModal] = useState<boolean>(importMode);
  const [datasourceId, setDatasourceId] = useState(() => {
    if (!datasources) return null;
    if (
      settings?.defaultDataSource &&
      datasources.find((d) => d.id === settings.defaultDataSource)?.properties
        ?.pastExperiments
    ) {
      return settings.defaultDataSource;
    }
    return (
      datasources.filter((d) => d?.properties?.pastExperiments)?.[0]?.id ?? null
    );
  });
  const [importId, setImportId] = useState<string | null>(null);

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
        initialValue={selected ?? undefined}
        onClose={() => onClose()}
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
