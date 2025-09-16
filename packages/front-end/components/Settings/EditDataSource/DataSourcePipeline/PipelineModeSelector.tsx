import { Card, Flex, Grid, Text } from "@radix-ui/themes";

export type PipelineModeValue = "disabled" | "ephemeral" | "incremental";

type Props = {
  value: PipelineModeValue;
  setValue: (value: PipelineModeValue) => void;
  disabled?: boolean;
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

const PipelineModeSelector = ({ value, setValue, disabled }: Props) => {
  return (
    <Grid columns="3" gap="2" align="center">
      {options.map((opt) => {
        const selected = value === opt.value;
        return (
          <Card
            key={opt.value}
            asChild
            style={
              selected
                ? { boxShadow: "0 0 0 2px var(--violet-9) inset" }
                : undefined
            }
          >
            <button
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={opt.label}
              disabled={disabled}
              onClick={() => !disabled && setValue(opt.value)}
              style={{ width: "100%" }}
            >
              <Flex direction="column" gap="1" px="3" py="2" align="start">
                <Text weight={selected ? "bold" : "regular"}>{opt.label}</Text>
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
