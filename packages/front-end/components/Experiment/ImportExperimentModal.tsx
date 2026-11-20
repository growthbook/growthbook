import { FC, useEffect, useState } from "react";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { isProjectListValidForProject } from "shared/util";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useAuth } from "@/services/auth";
import useOrgSettings from "@/hooks/useOrgSettings";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import Button from "@/ui/Button";
import SelectField from "@/components/Forms/SelectField";
import Callout from "@/ui/Callout";
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
  const { datasources, project } = useDefinitions();
  const [selected, setSelected] =
    useState<null | Partial<ExperimentInterfaceStringDates>>(
      initialValue ?? null,
    );
  const [error, setError] = useState<string | null>(null);
  const [importModal, setImportModal] = useState<boolean>(importMode);
  const validDatasources = datasources
    .filter((d) => d.properties?.pastExperiments)
    .filter((d) => isProjectListValidForProject(d.projects, project));
  const [datasourceId, setDatasourceId] = useState(() => {
    if (!validDatasources?.length) return null;

    if (settings?.defaultDataSource) {
      const ds = validDatasources.find(
        (d) => d.id === settings.defaultDataSource,
      );
      if (ds) {
        return ds.id;
      }
    }

    return validDatasources[0].id;
  });
  const [importId, setImportId] = useState<string | null>(null);

  const { apiCall } = useAuth();

  const getImportId = async () => {
    setError(null);
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
        setError(
          e.message ?? "An error occurred. Please refresh and try again.",
        );
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
    <ModalStandard
      trackingEventModalType="import-experiment"
      header="Import Experiment"
      open={true}
      size="xl"
      close={() => onClose()}
      secondaryAction={
        <Button variant="ghost" onClick={() => setImportModal(false)}>
          Create from scratch
        </Button>
      }
    >
      {importId && (
        <ImportExperimentList
          key={importId}
          onImport={(create) => {
            setSelected(create);
          }}
          changeDatasource={setDatasourceId}
          importId={importId}
        />
      )}
      {error ? (
        <>
          <Callout status="error" mb="3">
            {error}
          </Callout>
          <SelectField
            label="Choose a Data Source"
            value={datasourceId}
            onChange={(value) => setDatasourceId(value)}
            options={validDatasources.map((d) => ({
              label: d.name,
              value: d.id,
            }))}
          />
        </>
      ) : null}
    </ModalStandard>
  );
};
export default ImportExperimentModal;
