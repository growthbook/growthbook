import { useState } from "react";
import { isProjectListValidForProject } from "shared/util";
import { MetricInterface } from "back-end/types/metric";
import { FactMetricInterface } from "back-end/types/fact-table";
import { useDefinitions } from "@/services/DefinitionsContext";
import FactMetricModal from "@/components/FactTables/FactMetricModal";
import MetricForm from "@/components/Metrics/MetricForm";

export type MetricModalState = {
  currentMetric?: MetricInterface;
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
      <MetricForm
        current={currentMetric}
        edit={mode === "edit"}
        duplicate={mode === "duplicate"}
        source={source + (mode === "duplicate" ? "-duplicate" : "")}
        onClose={close}
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

export function NewMetricModal({ close, source, datasource }: NewMetricProps) {
  const {
    factMetrics,
    metrics,
    factTables,
    project,
    getDatasourceById,
  } = useDefinitions();

  const filteredFactMetrics = factMetrics
    .filter((f) => !datasource || f.datasource === datasource)
    .filter((f) => isProjectListValidForProject(f.projects, project));

  const filteredMetrics = metrics
    .filter((f) => !datasource || f.datasource === datasource)
    .filter((f) => isProjectListValidForProject(f.projects, project));

  const filteredFactTables = factTables
    .filter((f) => !datasource || f.datasource === datasource)
    .filter((f) => isProjectListValidForProject(f.projects, project));

  // Determine the most appropriate default type based on what the org has already created
  // - If there are no fact tables yet, always default to legacy
  // - If there are more legacy metrics than fact metrics, default to legacy
  // - Otherwise, default to fact
  // TODO: add an org setting to explicitly override this default
  let defaultType: "fact" | "legacy" = "fact";
  if (filteredFactTables.length === 0) {
    defaultType = "legacy";
  } else if (filteredMetrics.length > filteredFactMetrics.length) {
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
