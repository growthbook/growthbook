import { useMemo } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { ObjectSchemaDef, ObjectSchemaField } from "shared/types/feature";
import Checkbox from "@/ui/Checkbox";
import Text from "@/ui/Text";
import { ObjectFieldInput } from "./ObjectValueField";

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

function valuePresentInSchema(
  obj: ParsedObject,
  field: ObjectSchemaField,
): boolean {
  if (!(field.key in obj)) return false;
  const v = obj[field.key];
  if (v === null) return !!field.nullable;
  return typeof v === field.type;
}

function previewDefault(
  defaultObj: ParsedObject,
  field: ObjectSchemaField,
): string {
  if (!(field.key in defaultObj)) return "(unset)";
  const v = defaultObj[field.key];
  if (v === null) return "null";
  if (field.type === "string") return `"${String(v)}"`;
  return String(v);
}

// Per-key inputs for an object-typed RULE value. Stores sparse JSON: keys not
// overridden are omitted entirely. Missing keys fall back to the feature's
// default at SDK payload-generation time.
export default function PartialObjectValueField({
  schema,
  value,
  setValue,
  defaultValue,
}: {
  schema: ObjectSchemaDef;
  value: string;
  setValue: (v: string) => void;
  // The feature's resolved default value (JSON-stringified). Shown per-key
  // when the user chooses "Use default" so they can see what they're keeping.
  defaultValue: string;
}) {
  const sparse = useMemo(() => safeParse(value), [value]);
  const defaultObj = useMemo(() => safeParse(defaultValue), [defaultValue]);

  const setKey = (key: string, override: boolean, newVal?: unknown) => {
    const next: ParsedObject = { ...sparse };
    if (override) {
      next[key] = newVal;
    } else {
      delete next[key];
    }
    setValue(JSON.stringify(next));
  };

  return (
    <Flex direction="column" gap="3">
      {schema.fields.map((field) => {
        const overrides = valuePresentInSchema(sparse, field);
        return (
          <Box key={field.key}>
            <Flex align="center" gap="3" mb="1">
              <Checkbox
                label="Override"
                value={overrides}
                setValue={(v) => {
                  if (v) {
                    const seed =
                      field.key in defaultObj
                        ? defaultObj[field.key]
                        : field.nullable
                          ? null
                          : field.type === "string"
                            ? ""
                            : field.type === "number"
                              ? 0
                              : false;
                    setKey(field.key, true, seed);
                  } else {
                    setKey(field.key, false);
                  }
                }}
              />
              <Text size="small" color="text-mid">
                default: {previewDefault(defaultObj, field)}
              </Text>
            </Flex>
            {overrides ? (
              <ObjectFieldInput
                field={field}
                value={sparse[field.key]}
                onChange={(v) => setKey(field.key, true, v)}
              />
            ) : (
              <Flex align="center" gap="3" style={{ opacity: 0.6 }}>
                <Box style={{ minWidth: 140 }}>
                  <Text weight="medium">{field.key}</Text>
                  <Text size="small" color="text-mid" ml="1">
                    ({field.type}
                    {field.nullable ? ", nullable" : ""})
                  </Text>
                </Box>
                <Text size="medium" color="text-mid">
                  using default
                </Text>
              </Flex>
            )}
          </Box>
        );
      })}
    </Flex>
  );
}
