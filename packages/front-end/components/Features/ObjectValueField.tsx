import { Box, Flex, TextField } from "@radix-ui/themes";
import { ObjectSchemaDef, ObjectSchemaField } from "shared/types/feature";
import { useMemo } from "react";
import Checkbox from "@/ui/Checkbox";
import Text from "@/ui/Text";

type ParsedObject = Record<string, unknown>;

function safeParse(value: string): ParsedObject {
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as ParsedObject;
    }
  } catch {
    // ignore
  }
  return {};
}

function defaultValueFor(field: ObjectSchemaField): unknown {
  if (field.nullable) return null;
  if (field.type === "string") return "";
  if (field.type === "number") return 0;
  return false;
}

function fillMissingKeys(
  obj: ParsedObject,
  schema: ObjectSchemaDef,
): ParsedObject {
  const out: ParsedObject = {};
  for (const field of schema.fields) {
    out[field.key] = field.key in obj ? obj[field.key] : defaultValueFor(field);
  }
  return out;
}

// Per-key inputs for an object-typed default value. Stores the complete JSON
// object (every schema key present). For sparse rule overrides use
// PartialObjectValueField instead.
export default function ObjectValueField({
  schema,
  value,
  setValue,
}: {
  schema: ObjectSchemaDef;
  value: string;
  setValue: (v: string) => void;
}) {
  const parsed = useMemo(
    () => fillMissingKeys(safeParse(value), schema),
    [value, schema],
  );

  const update = (key: string, v: unknown) => {
    setValue(JSON.stringify({ ...parsed, [key]: v }));
  };

  return (
    <Flex direction="column" gap="2">
      {schema.fields.map((field) => (
        <ObjectFieldInput
          key={field.key}
          field={field}
          value={parsed[field.key]}
          onChange={(v) => update(field.key, v)}
        />
      ))}
    </Flex>
  );
}

export function ObjectFieldInput({
  field,
  value,
  onChange,
}: {
  field: ObjectSchemaField;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const isNull = value === null;
  return (
    <Flex align="center" gap="3">
      <Box style={{ minWidth: 140 }}>
        <Text weight="medium">{field.key}</Text>
        <Text size="small" color="text-mid" ml="1">
          ({field.type}
          {field.nullable ? ", nullable" : ""})
        </Text>
      </Box>
      <Box style={{ flex: 1 }}>
        {isNull ? (
          <Text color="text-mid" size="medium">
            null
          </Text>
        ) : field.type === "boolean" ? (
          <Checkbox
            label={value ? "true" : "false"}
            value={!!value}
            setValue={(v) => onChange(!!v)}
          />
        ) : field.type === "number" ? (
          <TextField.Root
            type="number"
            step="any"
            value={value === undefined || value === null ? "" : String(value)}
            onChange={(e) => {
              const n = parseFloat(e.target.value);
              onChange(Number.isFinite(n) ? n : 0);
            }}
          />
        ) : (
          <TextField.Root
            value={value === undefined || value === null ? "" : String(value)}
            onChange={(e) => onChange(e.target.value)}
          />
        )}
      </Box>
      {field.nullable && (
        <Checkbox
          label="null"
          value={isNull}
          setValue={(v) => {
            if (v) {
              onChange(null);
            } else {
              onChange(
                field.type === "string"
                  ? ""
                  : field.type === "number"
                    ? 0
                    : false,
              );
            }
          }}
        />
      )}
    </Flex>
  );
}
