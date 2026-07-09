import { useState } from "react";
import { isProjectListValidForProject } from "shared/util";
import {
  MetricDefinitionInterface,
  MetricInterface,
} from "shared/types/metric";
import { FactMetricInterface } from "shared/types/fact-table";
import { useDefinitions } from "@/services/DefinitionsContext";
import FactMetricModal from "@/components/FactTables/FactMetricModal";
import MetricForm from "@/components/Metrics/MetricForm";
import useApi from "@/hooks/useApi";
import LoadingOverlay from "@/components/LoadingOverlay";
import Modal from "@/ui/Modal";
import Callout from "@/ui/Callout";
import Button from "@/ui/Button";

export type MetricModalState = {
  currentMetric?: MetricDefinitionInterface;
  currentFactMetric?: FactMetricInterface;
  mode: "edit" | "duplicate" | "new";
};

export type MetricModalProps = MetricModalState & {
  close: () => void;
  source: string;
  datasource?: string;
};

export interface NewMetricProps {
  close: () => void;
  source: string;
  datasource?: string;
}

export function MetricModal({
  close,
  mode,
  source,
  currentFactMetric,
  currentMetric,
  datasource,
}: MetricModalProps) {
  if (mode === "new") {
    return (
      <NewMetricModal close={close} source={source} datasource={datasource} />
    );
  } else if (currentMetric) {
    return (
      <EditMetricModal
        close={close}
        mode={mode}
        source={source}
        currentMetric={currentMetric}
      />
    );
  } else if (currentFactMetric) {
    return (
      <FactMetricModal
        close={close}
        source={source + (mode === "duplicate" ? "-duplicate" : "")}
        duplicate={mode === "duplicate"}
        existing={currentFactMetric}
      />
    );
  } else {
    // This should never happen
    return null;
  }
}

// Metrics coming from the definitions endpoint are missing heavy fields like
// `sql`, so fetch the full metric before seeding the form. Otherwise saving an
// edit would silently wipe those fields.
function EditMetricModal({
  close,
  mode,
  source,
  currentMetric,
}: {
  close: () => void;
  mode: "edit" | "duplicate";
  source: string;
  currentMetric: MetricDefinitionInterface;
}) {
  const { data, error } = useApi<{ metric: MetricInterface }>(
    `/metric/${currentMetric.id}`,
  );

  if (error) {
    return (
      <Modal.Root
        open={true}
        onOpenChange={(open) => {
          if (!open) close();
        }}
        dismissible
        hasDescription={false}
        trackingEventModalType=""
      >
        <Modal.Header>
          <Modal.Title>
            {mode === "edit" ? "Edit Metric" : "Duplicate Metric"}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Callout status="error">{error.message}</Callout>
        </Modal.Body>
        <Modal.Footer>
          <Modal.Close>
            <Button variant="ghost" onClick={close}>
              Close
            </Button>
          </Modal.Close>
        </Modal.Footer>
      </Modal.Root>
    );
  }
  if (!data) {
    return <LoadingOverlay />;
  }

  // When duplicating, apply only the caller's intended overrides on top of the
  // full fetched metric — the rest of currentMetric is a possibly-stale
  // definitions copy
  const current: MetricInterface =
    mode === "edit"
      ? data.metric
      : {
          ...data.metric,
          name: currentMetric.name,
          managedBy: currentMetric.managedBy,
        };

  return (
    <MetricForm
      current={current}
      edit={mode === "edit"}
      duplicate={mode === "duplicate"}
      source={source + (mode === "duplicate" ? "-duplicate" : "")}
      onClose={close}
    />
  );
}

export function NewMetricModal({ close, source, datasource }: NewMetricProps) {
  const { factTables, project, getDatasourceById } = useDefinitions();

  const filteredFactTables = factTables
    .filter((f) => !datasource || f.datasource === datasource)
    .filter((f) => isProjectListValidForProject(f.projects, project));

  // Determine the most appropriate default type based on what the org has already created
  // - If there are no fact tables, default to legacy
  // - Otherwise, default to fact
  let defaultType: "fact" | "legacy" = "fact";
  if (filteredFactTables.length === 0) {
    defaultType = "legacy";
  }

  // What type of metric we're creating - fact or non-fact
  const [type, setType] = useState(defaultType);

  if (type === "fact") {
    return (
      <FactMetricModal
        close={close}
        source={source}
        switchToLegacy={() => {
          setType("legacy");
        }}
        datasource={datasource}
      />
    );
  } else {
    const defaultProjects =
      (datasource ? getDatasourceById(datasource)?.projects : null) ??
      (project ? [project] : []);

    return (
      <MetricForm
        current={{
          datasource: datasource,
          projects: defaultProjects,
        }}
        edit={false}
        source={source}
        onClose={close}
        switchToFact={() => {
          setType("fact");
        }}
      />
    );
  }
}
