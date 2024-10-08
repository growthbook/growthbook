import { useState } from "react";
import { useDefinitions } from "@/services/DefinitionsContext";
import FactMetricModal from "@/components/FactTables/FactMetricModal";
import MetricForm from "@/components/Metrics/MetricForm";

export interface Props {
  close: () => void;
  source: string;
  datasource?: string;
}

export default function NewMetricModal({ close, source, datasource }: Props) {
  const { factTables } = useDefinitions();

  const hasFactTables = datasource
    ? factTables.some((f) => f.datasource === datasource)
    : factTables.length > 0;

  // What type of metric we're creating - fact or non-fact
  const [type, setType] = useState<"fact" | "legacy">(
    hasFactTables ? "fact" : "legacy"
  );

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
