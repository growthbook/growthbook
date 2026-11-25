import { Flex, Grid } from "@radix-ui/themes";
import type { I18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
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
  i18n: I18n,
  jsonSchema: ApiInterleavingInterface["jsonSchema"] = null,
): string | null {
  for (const { role, label: labelDescriptor } of RANKERS) {
    const r = rankers[role];
    const label = i18n._(labelDescriptor);
    if (!r.key.trim()) return i18n._(msg`${label}: key is required`);
    const err = getRankerConfigError(r.config, jsonSchema);
    if (err) return i18n._(msg`${label}: ${err}`);
  }
  if (rankers.control.key.trim() === rankers.treatment.key.trim()) {
    return i18n._(msg`The two rankers need different keys`);
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
  const { t, i18n } = useLingui();
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
            name={ranker.name || ranker.key || i18n._(label)}
          >
            <Flex gap="3">
              <Field
                label={t`Key`}
                value={ranker.key}
                onChange={(e) => update(role, { key: e.target.value })}
                required
                containerClassName="flex-1"
              />
              <Field
                label={t`Name`}
                value={ranker.name}
                onChange={(e) => update(role, { name: e.target.value })}
                containerClassName="flex-1"
              />
            </Flex>
            <Field
              label={t`Description`}
              value={ranker.description ?? ""}
              onChange={(e) => update(role, { description: e.target.value })}
            />
            <CodeTextArea
              label={t`Config (JSON)`}
              language="json"
              value={ranker.config}
              setValue={(config) => update(role, { config })}
              minLines={4}
              maxLines={16}
              error={getRankerConfigError(ranker.config, jsonSchema) ?? ""}
              helpText={t`Passed to getList() in the SDK for this ranker.`}
            />
          </RankerCard>
        );
      })}
    </Grid>
  );
}
