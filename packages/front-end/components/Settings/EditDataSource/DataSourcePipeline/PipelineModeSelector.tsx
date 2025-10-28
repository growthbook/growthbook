import { PIPELINE_MODE_SUPPORTED_DATA_SOURCE_TYPES } from "shared/enterprise";
import type { DataSourceType } from "back-end/types/datasource";
import { useGrowthBook } from "@growthbook/growthbook-react";
import RadioGroup from "@/ui/RadioGroup";
import { AppFeatures } from "@/types/app-features";

export type PipelineModeValue = "disabled" | "ephemeral" | "incremental";

type Props = {
  value: PipelineModeValue;
  setValue: (value: PipelineModeValue) => void;
  disabled?: boolean;
  dataSourceType: DataSourceType;
};

const PipelineModeSelector = ({
  value,
  setValue,
  disabled,
  dataSourceType,
}: Props) => {
  const gb = useGrowthBook<AppFeatures>();
  const isIncrementalPipelineAvailable =
    gb?.isOn("incremental-refresh") ?? false;

  const isModeSupported = (mode: PipelineModeValue): boolean => {
    if (mode === "disabled") return true;
    return (
      PIPELINE_MODE_SUPPORTED_DATA_SOURCE_TYPES[mode]?.includes(
        dataSourceType,
      ) ?? false
    );
  };

  const options = [
    {
      value: "disabled",
      label: "Disabled",
      description: "Run standard queries only — do not write tables",
    },
    {
      value: "ephemeral",
      label: "Ephemeral",
      description: "Create short-lived intermediate tables per analysis",
      disabled: !isModeSupported("ephemeral"),
    },
  ];

  if (isIncrementalPipelineAvailable || value === "incremental") {
    options.push({
      value: "incremental",
      label: "Incremental",
      description: "Scan only new rows and reuse persisted tables",
      disabled: !isModeSupported("incremental"),
    });
  }

  return (
    <RadioGroup
      value={value}
      setValue={setValue}
      disabled={disabled}
      options={options}
      labelSize="3"
      descriptionSize="3"
    />
  );
};

export default PipelineModeSelector;
