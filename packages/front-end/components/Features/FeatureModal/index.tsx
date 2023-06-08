import { useForm } from "react-hook-form";
import {
  FeatureEnvironment,
  FeatureInterface,
  FeatureValueType,
} from "back-end/types/feature";
import dJSON from "dirty-json";
import { ReactElement, useState } from "react";
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
import MarkdownInput from "@/components/Markdown/MarkdownInput";
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

  // @ts-expect-error TS(2322) If you come across this, please fix it!: Type '{ valueType: FeatureValueType; defaultValue:... Remove this comment to see the full error message
  const form = useForm({ defaultValues });

  const [showTags, setShowTags] = useState(
    // @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'.
    featureToDuplicate?.tags?.length > 0
  );
  const [showDescription, setShowDescription] = useState(
    // @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'.
    featureToDuplicate?.description?.length > 0
  );

  const { apiCall } = useAuth();

  const valueType = form.watch("valueType") as FeatureValueType;
  const environmentSettings = form.watch("environmentSettings");

  const modalHeader = featureToDuplicate
    ? `Duplicate Feature (${featureToDuplicate.id})`
    : "Create Feature";

  let ctaEnabled = true;
  let disabledMessage: string | undefined;

  if (!permissions.check("createFeatureDrafts", project)) {
    ctaEnabled = false;
    disabledMessage =
      "You don't have permission to create feature flag drafts.";
  }

  return (
    <Modal
      open
      size="lg"
      inline={inline}
      header={modalHeader}
      cta={cta}
      close={close}
      ctaEnabled={ctaEnabled}
      disabledMessage={disabledMessage}
      secondaryCTA={secondaryCTA}
      submit={form.handleSubmit(async (values) => {
        const { defaultValue, ...feature } = values;
        const valueType = feature.valueType as FeatureValueType;
        const passedFeature = feature as FeatureInterface;
        const newDefaultValue = validateFeatureValue(
          passedFeature,
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
          // @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'.
          hasDescription: values.description.length > 0,
          initialRule: "none",
        });
        // @ts-expect-error TS(2345) If you come across this, please fix it!: Argument of type 'string[] | undefined' is not ass... Remove this comment to see the full error message
        refreshTags(values.tags);
        refreshWatching();

        await onSuccess(res.feature);
      })}
    >
      <FeatureKeyField keyField={form.register("id")} />

      {showTags ? (
        <TagsField
          // @ts-expect-error TS(2322) If you come across this, please fix it!: Type 'string[] | undefined' is not assignable to t... Remove this comment to see the full error message
          value={form.watch("tags")}
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
            // @ts-expect-error TS(2322) If you come across this, please fix it!: Type 'string | undefined' is not assignable to typ... Remove this comment to see the full error message
            value={form.watch("description")}
            setValue={(value) => form.setValue("description", value)}
            autofocus={!featureToDuplicate?.description?.length}
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

      {!featureToDuplicate && (
        <ValueTypeField
          value={valueType}
          onChange={(val) => {
            const defaultValue = getDefaultValue(val);
            form.setValue("valueType", val);
            form.setValue("defaultValue", defaultValue);
          }}
        />
      )}

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
          <FeatureValueField
            label={"Default Value when Enabled"}
            id="defaultValue"
            value={form.watch("defaultValue")}
            setValue={(v) => form.setValue("defaultValue", v)}
            valueType={valueType}
          />

          <div className="alert alert-info">
            After creating your feature, you will be able to add targeted rules
            such as <strong>A/B Tests</strong> and{" "}
            <strong>Percentage Rollouts</strong> to control exactly how it gets
            released to users.
          </div>
        </>
      )}
    </Modal>
  );
}
