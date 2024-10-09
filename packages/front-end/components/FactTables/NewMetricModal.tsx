import { useState } from "react";
import { isProjectListValidForProject } from "shared/util";
import { useDefinitions } from "@/services/DefinitionsContext";
import FactMetricModal from "@/components/FactTables/FactMetricModal";
import MetricForm from "@/components/Metrics/MetricForm";

export interface Props {
  close: () => void;
  source: string;
  datasource?: string;
}

export default function NewMetricModal({ close, source, datasource }: Props) {
  const { factMetrics, metrics, factTables, project } = useDefinitions();

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
    return (
      <MetricForm
        current={{
          datasource: datasource,
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
