import { Flex } from "@radix-ui/themes";
import type { ShowAs } from "shared/validators";
import Text from "@/ui/Text";
import RadioGroup from "@/ui/RadioGroup";

export default function ShowAsInput({
  options,
  value,
  unit,
  setValue,
}: {
  options: readonly ShowAs[];
  value: ShowAs;
  unit: string | null;
  setValue: (value: ShowAs) => void;
}) {
  // Keyed by every ShowAs so a new option can't ship without a label.
  const labels: Record<ShowAs, string> = {
    total: "Event totals",
    per_unit: `Per ${unit ?? "unit"}`,
  };
  return (
    <Flex direction="column" gap="2">
      <Text weight="medium">Show as</Text>
      <RadioGroup
        options={options.map((option) => ({
          label: labels[option],
          value: option,
        }))}
        value={value}
        setValue={(v) => setValue(v as ShowAs)}
      />
    </Flex>
  );
}
