import { Flex } from "@radix-ui/themes";
import type { ShowAs } from "shared/validators";
import Text from "@/ui/Text";
import RadioGroup from "@/ui/RadioGroup";

export default function ShowAsInput({
  value,
  unit,
  setValue,
}: {
  value: ShowAs;
  unit: string | null;
  setValue: (value: ShowAs) => void;
}) {
  return (
    <Flex direction="column" gap="2">
      <Text weight="medium">Show as</Text>
      <RadioGroup
        options={[
          { label: "Event totals", value: "total" },
          { label: `Per ${unit ?? "unit"}`, value: "per_unit" },
        ]}
        value={value}
        setValue={(v) => setValue(v as ShowAs)}
      />
    </Flex>
  );
}
