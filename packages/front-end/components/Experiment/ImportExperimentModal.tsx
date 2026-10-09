import { FC, useEffect, useState } from "react";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { isProjectListValidForProject } from "shared/util";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useAuth } from "@/services/auth";
import useOrgSettings from "@/hooks/useOrgSettings";
import LoadingOverlay from "@/components/LoadingOverlay";
import Modal from "@/ui/Modal";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import Link from "@/ui/Link";
import { Select, SelectItem } from "@/ui/Select";
import Text from "@/ui/Text";
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

  const footer = (
    <Modal.Footer justify="between">
      <Text color="text-mid">
        Don&apos;t see your experiment?{" "}
        <Link onClick={() => setImportModal(false)}>Create from scratch</Link>
      </Text>
      <Button variant="ghost" onClick={onClose}>
        Close
      </Button>
    </Modal.Footer>
  );

  return (
    <Modal.Root
      open={true}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      size="xl"
      dismissible
      hasDescription={!!importId && !error}
      trackingEventModalType="import-experiment"
    >
      {importId && !error ? (
        <ImportExperimentList
          key={importId}
          onImport={setSelected}
          changeDatasource={setDatasourceId}
          importId={importId}
          footer={footer}
        />
      ) : (
        <>
          <Modal.Header>
            <Modal.Title>Import Experiment</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            {error ? (
              <>
                <Callout status="error" mb="3">
                  {error}
                </Callout>
                <Select
                  label="Choose a Data Source"
                  value={datasourceId}
                  setValue={(value) => setDatasourceId(value)}
                >
                  {validDatasources.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.name}
                    </SelectItem>
                  ))}
                </Select>
              </>
            ) : (
              <LoadingOverlay />
            )}
          </Modal.Body>
          {footer}
        </>
      )}
    </Modal.Root>
  );
};
export default ImportExperimentModal;
