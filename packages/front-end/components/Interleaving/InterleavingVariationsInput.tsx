import { Box, Flex, Grid } from "@radix-ui/themes";
import type {
  ApiCreateInterleavingBody,
  ApiInterleavingInterface,
} from "shared/validators";
import { parseInterleavingRankerConfig } from "shared/util";
import Field from "@/components/Forms/Field";
import CodeTextArea from "@/components/Forms/CodeTextArea";
import VariationLabel from "@/ui/VariationLabel";

export type InterleavingRankers = ApiCreateInterleavingBody["variations"];

const RANKERS = [
  { role: "control", label: "Control" },
  { role: "treatment", label: "Treatment" },
] as const;

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
  disabled,
}: {
  value: InterleavingRankers;
  setValue: (value: InterleavingRankers) => void;
  jsonSchema?: ApiInterleavingInterface["jsonSchema"];
  disabled?: boolean;
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
          <Box
            key={role}
            p="5"
            pb="3"
            className="appbox mb-0 position-relative variation"
          >
            <Box
              className={`variation variation${i} with-variation-color`}
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                right: 0,
                height: "6px",
              }}
            />
            <Box mb="3">
              <VariationLabel
                number={i}
                name={ranker.name || ranker.key || label}
                size="lg"
              />
            </Box>
            <Flex gap="3">
              <Field
                label="Key"
                value={ranker.key}
                onChange={(e) => update(role, { key: e.target.value })}
                disabled={disabled}
                required
                containerClassName="flex-1"
              />
              <Field
                label="Name"
                value={ranker.name}
                onChange={(e) => update(role, { name: e.target.value })}
                disabled={disabled}
                containerClassName="flex-1"
              />
            </Flex>
            <Field
              label="Description"
              value={ranker.description ?? ""}
              onChange={(e) => update(role, { description: e.target.value })}
              disabled={disabled}
            />
            <CodeTextArea
              label="Config (JSON)"
              language="json"
              value={ranker.config}
              setValue={(config) => update(role, { config })}
              minLines={4}
              maxLines={16}
              disabled={disabled}
              error={getRankerConfigError(ranker.config, jsonSchema) ?? ""}
              helpText="Passed to getList() in the SDK for this ranker."
            />
          </Box>
        );
      })}
    </Grid>
  );
}
