import { Flex, Grid } from "@radix-ui/themes";
import type {
  ApiCreateInterleavingBody,
  ApiInterleavingInterface,
} from "shared/validators";
import { parseInterleavingRankerConfig } from "shared/util";
import Field from "@/components/Forms/Field";
import CodeTextArea from "@/components/Forms/CodeTextArea";
import RankerCard, { RANKERS } from "./RankerCard";

export type InterleavingRankers = ApiCreateInterleavingBody["variations"];

function toSchemaDef(jsonSchema: ApiInterleavingInterface["jsonSchema"]) {
  return jsonSchema ? { ...jsonSchema, date: new Date(jsonSchema.date) } : null;
}

export function getRankerConfigError(
  config: string,
  jsonSchema: ApiInterleavingInterface["jsonSchema"] = null,
): string | null {
  try {
    parseInterleavingRankerConfig(config, toSchemaDef(jsonSchema));
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

export function getRankersError(
  rankers: InterleavingRankers,
  jsonSchema: ApiInterleavingInterface["jsonSchema"] = null,
): string | null {
  for (const { role, label } of RANKERS) {
    const r = rankers[role];
    if (!r.key.trim()) return `${label}: key is required`;
    const err = getRankerConfigError(r.config, jsonSchema);
    if (err) return `${label}: ${err}`;
  }
  if (rankers.control.key.trim() === rankers.treatment.key.trim()) {
    return "The two rankers need different keys";
  }
  return null;
}

export default function InterleavingVariationsInput({
  value,
  setValue,
  jsonSchema = null,
}: {
  value: InterleavingRankers;
  setValue: (value: InterleavingRankers) => void;
  jsonSchema?: ApiInterleavingInterface["jsonSchema"];
}) {
  const update = (
    role: keyof InterleavingRankers,
    changes: Partial<InterleavingRankers["control"]>,
  ) => setValue({ ...value, [role]: { ...value[role], ...changes } });

  return (
    <Grid columns={{ initial: "1", md: "2" }} gap="4">
      {RANKERS.map(({ role, label }, i) => {
        const ranker = value[role];
        return (
          <RankerCard
            key={role}
            index={i}
            name={ranker.name || ranker.key || label}
          >
            <Flex gap="3">
              <Field
                label="Key"
                value={ranker.key}
                onChange={(e) => update(role, { key: e.target.value })}
                required
                containerClassName="flex-1"
              />
              <Field
                label="Name"
                value={ranker.name}
                onChange={(e) => update(role, { name: e.target.value })}
                containerClassName="flex-1"
              />
            </Flex>
            <Field
              label="Description"
              value={ranker.description ?? ""}
              onChange={(e) => update(role, { description: e.target.value })}
            />
            <CodeTextArea
              label="Config (JSON)"
              language="json"
              value={ranker.config}
              setValue={(config) => update(role, { config })}
              minLines={4}
              maxLines={16}
              error={getRankerConfigError(ranker.config, jsonSchema) ?? ""}
              helpText="Passed to getList() in the SDK for this ranker."
            />
          </RankerCard>
        );
      })}
    </Grid>
  );
}
