import { useMemo, useState } from "react";
import { FeatureInterface, SimpleSchema } from "shared/types/feature";
import { Box } from "@radix-ui/themes";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import { useAuth } from "@/services/auth";
import Callout from "@/ui/Callout";
import Text from "@/ui/Text";
import EditSimpleSchema from "./EditSimpleSchema";

const KEY_REGEX = /^[A-Za-z_][A-Za-z0-9_]*$/;
const VALID_FIELD_TYPES = new Set(["string", "integer", "float", "boolean"]);

const EMPTY_SCHEMA: SimpleSchema = { type: "object", fields: [] };

export default function EditObjectSchemaModal({
  feature,
  close,
  mutate,
}: {
  feature: FeatureInterface;
  close: () => void;
  mutate: () => void;
}) {
  const { apiCall } = useAuth();
  const [schema, setSchema] = useState<SimpleSchema>(
    feature.objectSchema ?? EMPTY_SCHEMA,
  );

  const existing = useMemo(
    () => feature.objectSchema?.fields ?? [],
    [feature.objectSchema],
  );
  const nextByKey = useMemo(
    () => new Map(schema.fields.map((f) => [f.key, f])),
    [schema.fields],
  );

  const removed: string[] = [];
  const retyped: string[] = [];
  for (const e of existing) {
    const nx = nextByKey.get(e.key);
    if (!nx) {
      removed.push(e.key);
    } else if (nx.type !== e.type) {
      retyped.push(e.key);
    }
  }
  const destructive = removed.length > 0 || retyped.length > 0;

  return (
    <ModalStandard
      trackingEventModalType=""
      open
      close={close}
      header="Edit Object Schema"
      cta="Save schema"
      size="md"
      submit={async () => {
        if (!schema.fields.length) {
          throw new Error("Schema must have at least one field.");
        }
        const seen = new Set<string>();
        for (const f of schema.fields) {
          if (!f.key || !KEY_REGEX.test(f.key)) {
            throw new Error(
              `Invalid key "${f.key}". Keys must start with a letter or _ and contain only letters, digits, and _.`,
            );
          }
          if (seen.has(f.key)) {
            throw new Error(`Duplicate key "${f.key}".`);
          }
          seen.add(f.key);
          if (!VALID_FIELD_TYPES.has(f.type)) {
            throw new Error(`Invalid field type "${f.type}".`);
          }
        }
        await apiCall(`/feature/${feature.id}/schema`, {
          method: "PUT",
          body: JSON.stringify({ objectSchema: schema }),
        });
        mutate();
      }}
    >
      <Box mb="3">
        <Text size="small" color="text-mid">
          Edits take effect immediately. Default values and rules for removed or
          retyped keys are filtered out of the SDK payload until you re-add or
          repair them.
        </Text>
      </Box>
      <EditSimpleSchema
        schema={schema}
        setSchema={setSchema}
        lockType="object"
      />
      {destructive && (
        <Box mt="3">
          <Callout status="warning">
            {removed.length > 0 && (
              <div>
                Removing key(s): <strong>{removed.join(", ")}</strong>. Values
                for these keys will stop being emitted in the SDK payload.
              </div>
            )}
            {retyped.length > 0 && (
              <div>
                Changing type for key(s): <strong>{retyped.join(", ")}</strong>.
                Existing values that don&apos;t match the new type will be
                silently dropped at SDK payload time.
              </div>
            )}
          </Callout>
        </Box>
      )}
    </ModalStandard>
  );
}
