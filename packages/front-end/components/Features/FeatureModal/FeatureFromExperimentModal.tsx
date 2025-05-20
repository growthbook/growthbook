import { useForm } from "react-hook-form";
import {
  ExperimentRefRule,
  ExperimentRefVariation,
  FeatureEnvironment,
  FeatureInterface,
  FeatureValueType,
} from "back-end/types/feature";
import dJSON from "dirty-json";
import { ReactElement, useState } from "react";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import Link from "next/link";
import { FaExternalLinkAlt } from "react-icons/fa";
import {
  filterEnvironmentsByExperiment,
  validateFeatureValue,
} from "shared/util";
import { useAuth } from "@/services/auth";
import Modal from "@/components/Modal";
import { useDefinitions } from "@/services/DefinitionsContext";
import track from "@/services/track";
import {
  getDefaultValue,
  useEnvironments,
  getDefaultVariationValue,
  validateFeatureRule,
  useFeaturesList,
} from "@/services/features";
import { useWatching } from "@/services/WatchProvider";
import MarkdownInput from "@/components/Markdown/MarkdownInput";
import SelectField from "@/components/Forms/SelectField";
import FeatureValueField from "@/components/Features/FeatureValueField";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import FeatureKeyField from "./FeatureKeyField";
import EnvironmentSelect from "./EnvironmentSelect";
import TagsField from "./TagsField";
import ValueTypeField from "./ValueTypeField";

export type Props = {
  close?: () => void;
  inline?: boolean;
  cta?: string;
  secondaryCTA?: ReactElement;
  experiment: ExperimentInterfaceStringDates;
  mutate: () => void;
};

function parseDefaultValue(
  defaultValue: string,
  valueType: FeatureValueType
): string {
  if (valueType === "boolean") {
    return defaultValue === "true" ? "true" : "false";
  }
  if (valueType === "number") {
    return parseFloat(defaultValue) + "";
  }
  if (valueType === "string") {
    return defaultValue;
  }
  try {
    return JSON.stringify(dJSON.parse(defaultValue), null, 2);
  } catch (e) {
    throw new Error(`JSON parse error for default value`);
  }
}

const genEnvironmentSettings = ({
  environments,
  permissions,
  project,
}: {
  environments: ReturnType<typeof useEnvironments>;
  permissions: ReturnType<typeof usePermissionsUtil>;
  project: string;
}): Record<string, FeatureEnvironment> => {
  const envSettings: Record<string, FeatureEnvironment> = {};

  environments.forEach((e) => {
    const canPublish = permissions.canPublishFeature({ project }, [e.id]);
    const defaultEnabled = canPublish ? e.defaultState ?? true : false;
    const enabled = canPublish ? defaultEnabled : false;
    const rules = [];
    envSettings[e.id] = { enabled, rules };
  });

  return envSettings;
};

const genFormDefaultValues = ({
  environments,
  permissions,
  project,
  experiment,
}: {
  environments: ReturnType<typeof useEnvironments>;
  permissions: ReturnType<typeof usePermissionsUtil>;
  project: string;
  experiment: ExperimentInterfaceStringDates;
}): Omit<FeatureInterface, "organization" | "dateCreated" | "dateUpdated"> & {
  variations: ExperimentRefVariation[];
  existing: string;
} => {
  const environmentSettings = genEnvironmentSettings({
    environments,
    permissions,
    project,
  });
  const type = experiment.variations.length > 2 ? "string" : "boolean";
  const defaultValue = getDefaultValue(type);
  return {
    existing: "",
    valueType: type,
    defaultValue,
    version: 1,
    description: experiment.description || "",
    id: "",
    owner: "",
    project,
    tags: experiment.tags || [],
    environmentSettings,
    variations: experiment.variations.map((v, i) => {
      return {
        value: i ? getDefaultVariationValue(defaultValue) : defaultValue,
        variationId: v.id,
      };
    }),
  };
};

export default function FeatureFromExperimentModal({
  close,
  inline,
  cta = "Create",
  secondaryCTA,
  experiment,
  mutate,
}: Props) {
  const { project, refreshTags } = useDefinitions();
  const allEnvironments = useEnvironments();
  const environments = filterEnvironmentsByExperiment(
    allEnvironments,
    experiment
  );
  const permissionsUtil = usePermissionsUtil();
  const { refreshWatching } = useWatching();

  const defaultValues = genFormDefaultValues({
    environments,
    permissions: permissionsUtil,
    experiment,
    project,
  });

  const { features, mutate: mutateFeatures } = useFeaturesList(false);

  // TODO: include features where the only reference to this experiment is an old revision
  const validFeatures = features.filter((f) => {
    if (f.archived) return false;
    // Skip features that already have this experiment
    if (experiment.linkedFeatures?.includes(f.id)) return false;
    if ((experiment.project || "") !== (f.project || "")) return false;
    return true;
  });

  const form = useForm({ defaultValues });

  const [showTags, setShowTags] = useState(
    experiment.tags && experiment.tags.length > 0
  );
  const [showDescription, setShowDescription] = useState(
    experiment.description && experiment.description.length > 0
  );

  const { apiCall } = useAuth();

  const valueType = form.watch("valueType") as FeatureValueType;
  const environmentSettings = form.watch("environmentSettings");

  let ctaEnabled = true;
  let disabledMessage: string | undefined;

  if (
    !permissionsUtil.canManageFeatureDrafts({
      project: experiment.project ?? project,
    })
  ) {
    ctaEnabled = false;
    disabledMessage =
      "You don't have permission to create feature flag drafts.";
  }

  const existing = form.watch("existing");

  function updateValuesOnTypeChange(val: FeatureValueType) {
    // If existing value already matches, do nothing
    if (val === valueType) return;

    form.setValue("valueType", val);

    // Update defaultValue and variation values to match new type
    const transformValue = (v: string) => {
      if (val === "boolean") {
        return Boolean(v) && v !== "false" ? "true" : "false";
      } else if (val === "number") {
        return (Number(v) || 0) + "";
      } else if (val === "json") {
        if (valueType === "string")
          return `{\n  "value": ${JSON.stringify(v)}\n}`;
        return `{\n  "value": ${v}\n}`;
      } else {
        return v;
      }
    };

    form.setValue("defaultValue", transformValue(form.watch("defaultValue")));
    form.setValue(
      "variations",
      form.watch("variations").map((v) => ({
        ...v,
        value: transformValue(v.value),
      }))
    );
  }

  return (
    <Modal
      open
      size="lg"
      inline={inline}
      header={"Add Feature Flag to Experiment"}
      cta={cta}
      close={close}
      ctaEnabled={ctaEnabled}
      disabledMessage={disabledMessage}
      secondaryCTA={secondaryCTA}
      submit={form.handleSubmit(async (values) => {
        const { variations, existing, ...feature } = values;
        const valueType = feature.valueType as FeatureValueType;

        const featureToCreate = existing
          ? features.find((f) => f.id === existing)
          : feature;

        if (!featureToCreate) {
          throw new Error("Invalid feature selected");
        }

        let hasChanges = false;
        const rule: ExperimentRefRule = {
          type: "experiment-ref",
          description: "",
          id: "",
          condition: "",
          enabled: true,
          scheduleRules: [],
          experimentId: experiment.id,
          variations,
        };

        const newRule = validateFeatureRule(rule, feature as FeatureInterface);
        if (newRule) {
          form.setValue(
            "variations",
            (newRule as ExperimentRefRule).variations
          );
          hasChanges = true;
        }

        if (!existing) {
          const newDefaultValue = validateFeatureValue(
            feature as FeatureInterface,
            feature.defaultValue,
            "Value"
          );
          if (newDefaultValue !== feature.defaultValue) {
            form.setValue("defaultValue", newDefaultValue);
            hasChanges = true;
          }
        }

        if (hasChanges) {
          throw new Error(
            "We fixed some errors in the feature. If it looks correct, submit again."
          );
        }

        if (existing) {
          await apiCall(
            `/feature/${featureToCreate.id}/${featureToCreate.version}/experiment`,
            {
              method: "POST",
              body: JSON.stringify({
                rule: rule,
              }),
            }
          );
        } else {
          featureToCreate.defaultValue = parseDefaultValue(
            values.defaultValue,
            valueType
          );

          // Add experiment rule to all environments
          Object.values(featureToCreate.environmentSettings).forEach(
            (settings) => {
              settings.rules.push(rule);
            }
          );

          await apiCall<{ feature: FeatureInterface }>(`/feature`, {
            method: "POST",
            body: JSON.stringify(featureToCreate),
          });

          track("Feature Created", {
            valueType: featureToCreate.valueType,
            hasDescription: featureToCreate.description
              ? featureToCreate.description.length > 0
              : false,
            initialRule: "experiment-ref",
          });
          refreshTags(featureToCreate.tags || []);
          refreshWatching();
        }

        await mutate();
        await mutateFeatures();
      })}
    >
      <SelectField
        label="Create New or Use Existing?"
        options={validFeatures.map((f) => ({
          label: f.id + " (" + f.valueType + ")",
          value: f.id,
        }))}
        initialOption="Create New Feature"
        value={form.watch("existing")}
        onChange={(value) => {
          if (value) {
            const newFeature = validFeatures.find((f) => f.id === value);
            if (newFeature) {
              updateValuesOnTypeChange(newFeature.valueType);
              experiment.variations.forEach((_, i) =>
                form.setValue(`variations.${i}.value`, newFeature.defaultValue)
              );
            }
          }

          form.setValue("existing", value);
        }}
      />

      {!existing && (
        <>
          <FeatureKeyField keyField={form.register("id")} />

          {showTags ? (
            <TagsField
              value={form.watch("tags") || []}
              onChange={(tags) => form.setValue("tags", tags)}
            />
          ) : (
            <a
              href="#"
              className="badge badge-light badge-pill mr-3 mb-3"
              onClick={(e) => {
                e.preventDefault();
                setShowTags(true);
              }}
            >
              + tags
            </a>
          )}

          {showDescription ? (
            <div className="form-group">
              <label>Description</label>
              <MarkdownInput
                value={form.watch("description") || ""}
                setValue={(value) => form.setValue("description", value)}
                autofocus={true}
              />
            </div>
          ) : (
            <a
              href="#"
              className="badge badge-light badge-pill mb-3"
              onClick={(e) => {
                e.preventDefault();
                setShowDescription(true);
              }}
            >
              + description
            </a>
          )}

          <ValueTypeField
            value={valueType}
            onChange={(val) => {
              updateValuesOnTypeChange(val);
            }}
          />

          <EnvironmentSelect
            environmentSettings={environmentSettings}
            environments={environments}
            setValue={(env, on) => {
              environmentSettings[env.id].enabled = on;
              form.setValue("environmentSettings", environmentSettings);
            }}
          />
        </>
      )}

      {existing && (
        <div className="alert alert-info">
          A rule will be added to the top of every environment in a new draft
          revision. For more control over placement, you can add Experiment
          rules directly from the{" "}
          <Link href={`/features/${existing}`}>
            Feature page
            <FaExternalLinkAlt />
          </Link>{" "}
          instead.
        </div>
      )}

      <div className="form-group">
        <label>Variation Values</label>
        <div className="mb-3 bg-light border p-3">
          {experiment.variations.map((v, i) => (
            <FeatureValueField
              key={v.id}
              label={v.name}
              id={v.id}
              value={form.watch(`variations.${i}.value`) || ""}
              setValue={(v) => form.setValue(`variations.${i}.value`, v)}
              valueType={form.watch("valueType")}
            />
          ))}
        </div>
      </div>

      {!existing && (
        <FeatureValueField
          label={"Fallback value"}
          id="defaultValue"
          value={form.watch("defaultValue")}
          setValue={(v) => form.setValue("defaultValue", v)}
          valueType={valueType}
          helpText="For users not included in the experiment"
        />
      )}
    </Modal>
  );
}
