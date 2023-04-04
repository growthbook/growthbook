import { useForm } from "react-hook-form";
import {
  FeatureEnvironment,
  FeatureInterface,
  FeatureValueType,
} from "back-end/types/feature";
import dJSON from "dirty-json";
import { ReactElement } from "react";
import { useAuth } from "@/services/auth";
import Modal from "@/components/Modal";
import { useDefinitions } from "@/services/DefinitionsContext";
import track from "@/services/track";
import {
  getDefaultValue,
  validateFeatureValue,
  useEnvironments,
  genDuplicatedKey,
} from "@/services/features";
import { useWatching } from "@/services/WatchProvider";
import usePermissions from "@/hooks/usePermissions";
import FeatureValueField from "../FeatureValueField";
import FeatureKeyField from "./FeatureKeyField";
import EnvironmentSelect from "./EnvironmentSelect";
import TagsField from "./TagsField";
import ValueTypeField from "./ValueTypeField";

export type Props = {
  close?: () => void;
  onSuccess: (feature: FeatureInterface) => Promise<void>;
  inline?: boolean;
  cta?: string;
  secondaryCTA?: ReactElement;
  featureToDuplicate?: FeatureInterface;
  features?: FeatureInterface[];
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
  featureToDuplicate,
  permissions,
  project,
}: {
  environments: ReturnType<typeof useEnvironments>;
  featureToDuplicate?: FeatureInterface;
  permissions: ReturnType<typeof usePermissions>;
  project: string;
}): Record<string, FeatureEnvironment> => {
  const envSettings: Record<string, FeatureEnvironment> = {};

  environments.forEach((e) => {
    const canPublish = permissions.check("publishFeatures", project, [e.id]);
    const defaultEnabled = canPublish ? e.defaultState ?? true : false;
    const enabled = canPublish
      ? featureToDuplicate?.environmentSettings?.[e.id]?.enabled ??
        defaultEnabled
      : false;
    const rules = featureToDuplicate?.environmentSettings?.[e.id]?.rules ?? [];

    envSettings[e.id] = { enabled, rules };
  });

  return envSettings;
};

const genFormDefaultValues = ({
  environments,
  permissions,
  featureToDuplicate,
  project,
}: {
  environments: ReturnType<typeof useEnvironments>;
  permissions: ReturnType<typeof usePermissions>;
  featureToDuplicate?: FeatureInterface;
  project: string;
}) => {
  const environmentSettings = genEnvironmentSettings({
    environments,
    featureToDuplicate,
    permissions,
    project,
  });
  return featureToDuplicate
    ? {
        valueType: featureToDuplicate.valueType,
        defaultValue: featureToDuplicate.defaultValue,
        description: featureToDuplicate.description,
        id: genDuplicatedKey(featureToDuplicate),
        project: featureToDuplicate.project ?? project,
        tags: featureToDuplicate.tags,
        environmentSettings,
      }
    : {
        valueType: "boolean",
        defaultValue: getDefaultValue("boolean"),
        description: "",
        id: "",
        project,
        tags: [],
        environmentSettings,
      };
};

export default function FeatureModal({
  close,
  onSuccess,
  inline,
  cta = "Create",
  secondaryCTA,
  featureToDuplicate,
}: Props) {
  const { project, refreshTags } = useDefinitions();
  const environments = useEnvironments();
  const permissions = usePermissions();
  const { refreshWatching } = useWatching();

  const defaultValues = genFormDefaultValues({
    environments,
    permissions,
    featureToDuplicate,
    project,
  });

  const form = useForm({ defaultValues });

  const { apiCall } = useAuth();

  const valueType = form.watch("valueType") as FeatureValueType;
  const environmentSettings = form.watch("environmentSettings");

  const modalHeader = featureToDuplicate
    ? `Duplicate Feature (${featureToDuplicate.id})`
    : "Create Feature";

  return (
    <Modal
      open
      size="lg"
      inline={inline}
      header={modalHeader}
      cta={cta}
      close={close}
      secondaryCTA={secondaryCTA}
      submit={form.handleSubmit(async (values) => {
        const { defaultValue, ...feature } = values;
        const valueType = feature.valueType as FeatureValueType;

        const newDefaultValue = validateFeatureValue(
          valueType,
          defaultValue,
          "Value"
        );
        let hasChanges = false;
        if (newDefaultValue !== defaultValue) {
          form.setValue("defaultValue", newDefaultValue);
          hasChanges = true;
        }

        if (hasChanges) {
          throw new Error(
            "We fixed some errors in the feature. If it looks correct, submit again."
          );
        }

        const body = {
          ...feature,
          defaultValue: parseDefaultValue(defaultValue, valueType),
        };

        const res = await apiCall<{ feature: FeatureInterface }>(`/feature`, {
          method: "POST",
          body: JSON.stringify(body),
        });

        track("Feature Created", {
          valueType: values.valueType,
          hasDescription: values.description.length > 0,
          initialRule: "none",
        });
        refreshTags(values.tags);
        refreshWatching();

        await onSuccess(res.feature);
      })}
    >
      <FeatureKeyField keyField={form.register("id")} />

      <TagsField
        value={form.watch("tags")}
        onChange={(tags) => form.setValue("tags", tags)}
      />

      <EnvironmentSelect
        environmentSettings={environmentSettings}
        setValue={(env, on) => {
          environmentSettings[env.id].enabled = on;
          form.setValue("environmentSettings", environmentSettings);
        }}
      />

      {/* 
          We hide rule configuration when duplicating a feature since the 
          decision of which rule to display (out of potentially many) in the 
          modal is not deterministic.
      */}
      {!featureToDuplicate && (
        <>
          <hr />

          <h5>When Enabled</h5>

          <ValueTypeField
            value={valueType}
            onChange={(val) => {
              const defaultValue = getDefaultValue(val);
              form.setValue("valueType", val);
              form.setValue("defaultValue", defaultValue);
            }}
          />

          <FeatureValueField
            label={"Value"}
            id="defaultValue"
            value={form.watch("defaultValue")}
            setValue={(v) => form.setValue("defaultValue", v)}
            valueType={valueType}
          />

          <p>
            You can add complex rules later to control exactly how and when this
            feature gets released to users.
          </p>
        </>
      )}
    </Modal>
  );
}
