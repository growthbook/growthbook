import { useMemo } from "react";
import { Box, Flex, TextField } from "@radix-ui/themes";
import { PiTrash, PiPlus } from "react-icons/pi";
import { ObjectSchemaDef, ObjectSchemaField } from "shared/types/feature";
import Button from "@/ui/Button";
import { Select, SelectItem } from "@/ui/Select";
import Checkbox from "@/ui/Checkbox";
import Text from "@/ui/Text";
import HelperText from "@/ui/HelperText";

const FIELD_TYPES = ["string", "number", "boolean"] as const;
const KEY_REGEX = /^[A-Za-z_][A-Za-z0-9_]*$/;

type Props = {
  value: ObjectSchemaDef | undefined;
  setValue: (v: ObjectSchemaDef) => void;
  // When true, render compact (used inside a modal). Default false.
  compact?: boolean;
};

export default function ObjectSchemaEditor({
  value,
  setValue,
  compact,
}: Props) {
  const fields: ObjectSchemaField[] = useMemo(
    () => value?.fields ?? [],
    [value?.fields],
  );

  const errors = useMemo(() => {
    const out: { row: number; message: string }[] = [];
    const seen = new Set<string>();
    fields.forEach((f, i) => {
      if (!f.key) {
        out.push({ row: i, message: "Key is required" });
      } else if (!KEY_REGEX.test(f.key)) {
        out.push({
          row: i,
          message: "Key must start with a letter or _; letters/digits/_ only",
        });
      } else if (seen.has(f.key)) {
        out.push({ row: i, message: `Duplicate key "${f.key}"` });
      }
      if (f.key) seen.add(f.key);
    });
    return out;
  }, [fields]);

  const updateField = (idx: number, patch: Partial<ObjectSchemaField>) => {
    const next = fields.map((f, i) => (i === idx ? { ...f, ...patch } : f));
    setValue({ fields: next });
  };

  const removeField = (idx: number) => {
    const next = fields.filter((_, i) => i !== idx);
    setValue({ fields: next });
  };

  const addField = () => {
    const next: ObjectSchemaField[] = [...fields, { key: "", type: "string" }];
    setValue({ fields: next });
  };

  return (
    <Box>
      {!compact && (
        <Box mb="2">
          <Text size="small" color="text-mid" as="p">
            Define the keys this feature exposes. Each key has a primitive type
            and may be marked nullable. Rules can later override any subset of
            keys.
          </Text>
        </Box>
      )}
      <Flex direction="column" gap="2">
        {fields.map((field, i) => {
          const err = errors.find((e) => e.row === i);
          return (
            <Box key={i}>
              <Flex gap="2" align="center">
                <Box style={{ flex: 2 }}>
                  <TextField.Root
                    placeholder="key"
                    value={field.key}
                    onChange={(e) => updateField(i, { key: e.target.value })}
                  />
                </Box>
                <Box style={{ flex: 1, minWidth: 120 }}>
                  <Select
                    value={field.type}
                    setValue={(v) =>
                      updateField(i, {
                        type: v as ObjectSchemaField["type"],
                      })
                    }
                  >
                    {FIELD_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>
                        {t}
                      </SelectItem>
                    ))}
                  </Select>
                </Box>
                <Box style={{ flex: 0 }}>
                  <Checkbox
                    label="nullable"
                    value={!!field.nullable}
                    setValue={(v) => updateField(i, { nullable: !!v })}
                  />
                </Box>
                <Button
                  variant="ghost"
                  color="red"
                  size="sm"
                  icon={<PiTrash />}
                  onClick={() => removeField(i)}
                  aria-label={`Remove ${field.key || "field"}`}
                >
                  {""}
                </Button>
              </Flex>
              {err && (
                <Box ml="2">
                  <HelperText status="error">{err.message}</HelperText>
                </Box>
              )}
            </Box>
          );
        })}
      </Flex>
      <Box mt="2">
        <Button variant="soft" size="sm" icon={<PiPlus />} onClick={addField}>
          Add field
        </Button>
      </Box>
      {fields.length === 0 && (
        <HelperText status="error">At least one field is required.</HelperText>
      )}
    </Box>
  );
}
