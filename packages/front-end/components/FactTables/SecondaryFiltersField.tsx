import { Dispatch, SetStateAction } from "react";
import { Flex } from "@radix-ui/themes";
import { PiPlus, PiX } from "react-icons/pi";
import SelectField from "@/components/Forms/SelectField";
import Button from "@/ui/Button";

export type SecondaryFilterMapping = { value: string; column: string };

// Rows mapping a value of the column to another column to ask for. Shared by
// both column editors.
export default function SecondaryFiltersField({
  mappings,
  setMappings,
  topValues,
  columnOptions,
}: {
  mappings: SecondaryFilterMapping[];
  setMappings: Dispatch<SetStateAction<SecondaryFilterMapping[]>>;
  topValues: string[];
  columnOptions: { label: string; value: string }[];
}) {
  return (
    <Flex direction="column" gap="2">
      {mappings.map((m, i) => (
        <Flex key={i} gap="2" align="center">
          <SelectField
            aria-label="Value"
            containerStyle={{ flex: 1, minWidth: 0 }}
            containerClassName="mb-0"
            value={m.value}
            createable
            onChange={(value) =>
              setMappings((prev) =>
                // A value maps once; a duplicate would overwrite on save
                prev.some((x, j) => j !== i && x.value === value)
                  ? prev
                  : prev.map((x, j) => (j === i ? { ...x, value } : x)),
              )
            }
            options={topValues
              .filter(
                (v) => v === m.value || !mappings.some((x) => x.value === v),
              )
              .map((v) => ({ label: v, value: v }))}
            placeholder="Value..."
          />
          <span aria-hidden="true">→</span>
          <SelectField
            aria-label="Column to filter on"
            containerStyle={{ flex: 1, minWidth: 0 }}
            containerClassName="mb-0"
            value={m.column}
            onChange={(column) =>
              setMappings((prev) =>
                prev.map((x, j) => (j === i ? { ...x, column } : x)),
              )
            }
            options={columnOptions}
            placeholder="Filter on..."
          />
          <Button
            variant="ghost"
            size="sm"
            aria-label={`Remove ${m.value || "secondary filter"}`}
            onClick={() =>
              setMappings((prev) => prev.filter((_, j) => j !== i))
            }
          >
            <PiX />
          </Button>
        </Flex>
      ))}
      {mappings.every((m) => m.value && m.column) && (
        <Flex>
          <Button
            variant="ghost"
            size="sm"
            icon={<PiPlus />}
            onClick={() =>
              setMappings((prev) => [...prev, { value: "", column: "" }])
            }
          >
            Add value
          </Button>
        </Flex>
      )}
    </Flex>
  );
}
