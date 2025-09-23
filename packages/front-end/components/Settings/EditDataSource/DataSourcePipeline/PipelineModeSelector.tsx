import { Card, Flex, Grid, Text } from "@radix-ui/themes";
import { PIPELINE_MODE_SUPPORTED_DATA_SOURCE_TYPES } from "shared/enterprise";
import type { DataSourceType } from "back-end/types/datasource";

export type PipelineModeValue = "disabled" | "ephemeral" | "incremental";

type Props = {
  value: PipelineModeValue;
  setValue: (value: PipelineModeValue) => void;
  disabled?: boolean;
  dataSourceType: DataSourceType;
};

const options: {
  value: PipelineModeValue;
  label: string;
  description: string;
}[] = [
  {
    value: "disabled",
    label: "Disabled",
    description: "Do not write tables; run standard queries only.",
  },
  {
    value: "ephemeral",
    label: "Ephemeral",
    description: "Create short‑lived intermediate tables per analysis.",
  },
  {
    value: "incremental",
    label: "Incremental",
    description: "Scan only new rows and reuse persisted tables.",
  },
];

const PipelineModeSelector = ({
  value,
  setValue,
  disabled,
  dataSourceType,
}: Props) => {
  const isModeSupported = (mode: PipelineModeValue): boolean => {
    if (mode === "disabled") return true;
    return (
      PIPELINE_MODE_SUPPORTED_DATA_SOURCE_TYPES[mode]?.includes(
        dataSourceType,
      ) ?? false
    );
  };
  return (
    <Grid columns="3" gap="2" align="center">
      {options.map((opt) => {
        const selected = value === opt.value;
        const optionDisabled = disabled || !isModeSupported(opt.value);
        return (
          <Card
            key={opt.value}
            asChild
            style={
              selected
                ? {
                    boxShadow: "0 0 0 2px var(--violet-9) inset",
                    opacity: optionDisabled ? 0.6 : 1,
                  }
                : optionDisabled
                  ? { opacity: 0.6 }
                  : undefined
            }
          >
            <button
              type="button"
              role="radio"
              aria-checked={selected}
              aria-disabled={optionDisabled}
              aria-label={opt.label}
              disabled={optionDisabled}
              onClick={() => !optionDisabled && setValue(opt.value)}
              style={{
                width: "100%",
                cursor: optionDisabled ? "not-allowed" : undefined,
              }}
              title={
                !isModeSupported(opt.value)
                  ? `Not supported for ${dataSourceType}`
                  : undefined
              }
            >
              <Flex direction="column" gap="1" px="3" py="2" align="start">
                <Text
                  weight={selected ? "bold" : "regular"}
                  color={optionDisabled ? "gray" : undefined}
                >
                  {opt.label}
                </Text>
                <Text size="1" color="gray">
                  {opt.description}
                </Text>
              </Flex>
            </button>
          </Card>
        );
      })}
    </Grid>
  );
};

export default PipelineModeSelector;
