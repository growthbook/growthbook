import { SchemaField, SimpleSchema } from "shared/types/feature";
import { PiPlus, PiTrash } from "react-icons/pi";
import { Box, Flex } from "@radix-ui/themes";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import Button from "@/ui/Button";

// Minimal create-time editor for an object-typed feature's schema. Just key +
// type per row — all fields are stored as required, other SchemaField
// properties are seeded to defaults so the schema round-trips with
// EditSimpleSchema (used post-creation for richer edits).
const TYPE_OPTIONS = [
  { value: "string", label: "String" },
  { value: "float", label: "Number" },
  { value: "boolean", label: "Boolean" },
];

const VALID_TYPES = new Set(["string", "float", "boolean"]);

function newField(): SchemaField {
  return {
    key: "",
    type: "string",
    required: true,
    default: "",
    description: "",
    enum: [],
    min: 0,
    max: 256,
  };
}

export default function SimpleObjectSchemaInput({
  schema,
  setSchema,
}: {
  schema: SimpleSchema;
  setSchema: (schema: SimpleSchema) => void;
}) {
  const fields = schema.fields ?? [];

  const update = (idx: number, patch: Partial<SchemaField>) => {
    const next = fields.map((f, i) => (i === idx ? { ...f, ...patch } : f));
    setSchema({ ...schema, type: "object", fields: next });
  };
  const remove = (idx: number) => {
    setSchema({
      ...schema,
      type: "object",
      fields: fields.filter((_, i) => i !== idx),
    });
  };
  const add = () => {
    setSchema({
      ...schema,
      type: "object",
      fields: [...fields, newField()],
    });
  };

  return (
    <Box>
      <label className="font-weight-bold text-dark">Object Properties</label>
      <Flex direction="column" gap="2">
        {fields.map((field, i) => (
          <Flex key={i} gap="2" align="end">
            <Box style={{ flex: 2 }}>
              <Field
                placeholder="key"
                value={field.key}
                onChange={(e) => update(i, { key: e.target.value })}
                containerClassName="mb-0"
                maxLength={64}
                // Autofocus newly-added rows. `autoFocus` only fires on mount,
                // so existing rows don't get re-focused when their position
                // shifts after a remove — and a freshly appended row mounts
                // with an empty key so it picks up focus naturally.
                autoFocus={!field.key}
              />
            </Box>
            <Box style={{ flex: 1, minWidth: 140 }}>
              <SelectField
                value={
                  VALID_TYPES.has(field.type)
                    ? field.type
                    : // Map any pre-existing `integer` back to `float` so the
                      // simplified UI has something to show.
                      "float"
                }
                onChange={(v) => update(i, { type: v as SchemaField["type"] })}
                options={TYPE_OPTIONS}
                sort={false}
                containerClassName="mb-0"
              />
            </Box>
            <Button
              variant="ghost"
              color="red"
              size="sm"
              icon={<PiTrash />}
              onClick={() => remove(i)}
              aria-label="Remove field"
            >
              {""}
            </Button>
          </Flex>
        ))}
      </Flex>
      <Box mt="2">
        <Button variant="soft" size="sm" icon={<PiPlus />} onClick={add}>
          Add field
        </Button>
      </Box>
    </Box>
  );
}
