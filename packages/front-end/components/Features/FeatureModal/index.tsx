import { useForm, FormProvider } from "react-hook-form";
import {
  FeatureEnvironment,
  FeatureInterface,
  FeatureValueType,
} from "shared/types/feature";
import React, { ReactElement, useState } from "react";
import { validateFeatureValue } from "shared/util";
import { PiInfo } from "react-icons/pi";
import { useFeatureIsOn } from "@growthbook/growthbook-react";
import { HoldoutSelect } from "@/components/Holdout/HoldoutSelect";
import { useAuth } from "@/services/auth";
import Modal from "@/components/Modal";
import { useDefinitions } from "@/services/DefinitionsContext";
import track from "@/services/track";
import {
  genDuplicatedKey,
  getDefaultValue,
  parseDefaultValue,
  useEnvironments,
} from "@/services/features";
import Tooltip from "@/components/Tooltip/Tooltip";
import { useWatching } from "@/services/WatchProvider";
import MarkdownInput from "@/components/Markdown/MarkdownInput";
import { useDemoDataSourceProject } from "@/hooks/useDemoDataSourceProject";
import CustomFieldInput from "@/components/CustomFields/CustomFieldInput";
import {
  filterCustomFieldsForSectionAndProject,
  useCustomFields,
} from "@/hooks/useCustomFields";
import { useUser } from "@/services/UserContext";
import FeatureValueField from "@/components/Features/FeatureValueField";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import useProjectOptions from "@/hooks/useProjectOptions";
import useOrgSettings from "@/hooks/useOrgSettings";
import SelectField from "@/components/Forms/SelectField";
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

const genEnvironmentSettings = ({
  environments,
  featureToDuplicate,
  permissions,
  project,
}: {
  environments: ReturnType<typeof useEnvironments>;
  featureToDuplicate?: FeatureInterface;
  permissions: ReturnType<typeof usePermissionsUtil>;
  project: string;
}): Record<string, FeatureEnvironment> => {
  const envSettings: Record<string, FeatureEnvironment> = {};

  environments.forEach((e) => {
    const canPublish = permissions.canPublishFeature({ project }, [e.id]);
    const defaultEnabled = canPublish ? (e.defaultState ?? true) : false;
    const enabled = canPublish
      ? (featureToDuplicate?.environmentSettings?.[e.id]?.enabled ??
        defaultEnabled)
      : false;
    const rules = featureToDuplicate?.environmentSettings?.[e.id]?.rules ?? [];

    envSettings[e.id] = { enabled, rules };
  });

  return envSettings;
};

const genFormDefaultValues = ({
  environments,
  permissions: permissionsUtil,
  featureToDuplicate,
  project,
  customFields,
}: {
  environments: ReturnType<typeof useEnvironments>;
  permissions: ReturnType<typeof usePermissionsUtil>;
  featureToDuplicate?: FeatureInterface;
  project: string;
  customFields?: ReturnType<typeof useCustomFields>;
}): Pick<
  FeatureInterface,
  | "valueType"
  | "defaultValue"
  | "description"
  | "tags"
  | "project"
  | "id"
  | "environmentSettings"
  | "customFields"
  | "holdout"
> => {
  const environmentSettings = genEnvironmentSettings({
    environments,
    featureToDuplicate,
    permissions: permissionsUtil,
    project,
  });
  const customFieldValues = customFields
    ? Object.fromEntries(
        customFields.map((field) => [
          field.id,
          featureToDuplicate?.customFields?.[field.id] ?? field.defaultValue,
        ]),
      )
    : {};

  return featureToDuplicate
    ? {
        valueType: featureToDuplicate.valueType,
        defaultValue: featureToDuplicate.defaultValue,
        description: featureToDuplicate.description,
        id: genDuplicatedKey(featureToDuplicate),
        project: featureToDuplicate.project ?? project,
        tags: featureToDuplicate.tags,
        environmentSettings,
        customFields: customFieldValues,
        holdout: featureToDuplicate.holdout?.id
          ? featureToDuplicate.holdout
          : undefined,
      }
    : {
        valueType: "" as FeatureValueType,
        defaultValue: getDefaultValue("boolean"),
        description: "",
        id: "",
        project,
        tags: [],
        environmentSettings,
        customFields: customFieldValues,
        holdout: undefined,
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
  const permissionsUtil = usePermissionsUtil();
  const { refreshWatching } = useWatching();
  const { hasCommercialFeature } = useUser();
  const { requireProjectForFeatures } = useOrgSettings();

  const allCustomFields = useCustomFields();
  const initialCustomFields = filterCustomFieldsForSectionAndProject(
    allCustomFields,
    "feature",
    project,
  );

  const holdoutsEnabled = useFeatureIsOn("holdouts_feature");

  const defaultValues = genFormDefaultValues({
    environments,
    permissions: permissionsUtil,
    featureToDuplicate,
    project,
    customFields: hasCommercialFeature("custom-metadata")
      ? initialCustomFields
      : undefined,
  });

  const form = useForm({ defaultValues });

  const projectOptions = useProjectOptions(
    (project) =>
      permissionsUtil.canCreateFeature({ project }) &&
      permissionsUtil.canManageFeatureDrafts({ project }),
    project ? [project] : [],
  );
  const selectedProject = form.watch("project");
  const customFields = filterCustomFieldsForSectionAndProject(
    allCustomFields,
    "feature",
    selectedProject,
  );
  const { projectId: demoProjectId } = useDemoDataSourceProject();

  const [showTags, setShowTags] = useState(!!featureToDuplicate?.tags?.length);
  const [showDescription, setShowDescription] = useState(
    !!featureToDuplicate?.description?.length,
  );

  const { apiCall } = useAuth();

  const valueType = form.watch("valueType") as FeatureValueType;
  const environmentSettings = form.watch("environmentSettings");

  const modalHeader = featureToDuplicate
    ? `Duplicate Feature (${featureToDuplicate.id})`
    : "Create Feature";

  let ctaEnabled = true;
  let disabledMessage: string | undefined;

  if (
    !permissionsUtil.canManageFeatureDrafts({
      project: featureToDuplicate?.project ?? project,
    })
  ) {
    ctaEnabled = false;
    disabledMessage =
      "You don't have permission to create feature flag drafts.";
  }

  // We want to show a warning when someone tries to create a feature under the demo project
  const { currentProjectIsDemo } = useDemoDataSourceProject();

  return (
    <Modal
      trackingEventModalType=""
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
        const valueType = feature.valueType;
        const { holdout } = feature;

        if (!valueType) {
          throw new Error("Please select a value type");
        }

        const newDefaultValue = validateFeatureValue(
          feature,
          defaultValue,
          "Value",
        );
        let hasChanges = false;
        if (newDefaultValue !== defaultValue) {
          form.setValue("defaultValue", newDefaultValue);
          hasChanges = true;
        }

        if (hasChanges) {
          throw new Error(
            "We fixed some errors in the feature. If it looks correct, submit again.",
          );
        }

        const body = {
          ...feature,
          defaultValue: parseDefaultValue(defaultValue, valueType),
          holdout: {
            id: holdout?.id ?? "",
            value: parseDefaultValue(defaultValue, valueType),
          },
        };

        const res = await apiCall<{ feature: FeatureInterface }>(`/feature`, {
          method: "POST",
          body: JSON.stringify(body),
        });

        track("Feature Created", {
          valueType: values.valueType,
          hasDescription: !!values.description?.length,
          initialRule: "none",
        });
        values.tags && refreshTags(values.tags);
        refreshWatching();

        await onSuccess(res.feature);
      })}
    >
      <FormProvider {...form}>
        {currentProjectIsDemo && (
          <div className="alert alert-warning">
            You are creating a feature under the demo datasource project.
          </div>
        )}

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

        {projectOptions.length > 0 && (
          <>
            {selectedProject === demoProjectId && (
              <div className="alert alert-warning">
                You are creating a feature under the demo datasource project.
              </div>
            )}
            <SelectField
              label={
                <>
                  {" "}
                  Project{" "}
                  <Tooltip
                    body={
                      "The dropdown below has been filtered to only include projects where you have permission to update Features"
                    }
                  />{" "}
                </>
              }
              value={selectedProject || ""}
              onChange={(v) => {
                form.setValue("project", v);
              }}
              initialOption={requireProjectForFeatures ? undefined : "None"}
              options={projectOptions}
              required={requireProjectForFeatures}
            />
          </>
        )}

        {holdoutsEnabled && (
          <HoldoutSelect
            selectedProject={selectedProject}
            selectedHoldoutId={form.watch("holdout")?.id}
            setHoldout={(holdoutId) => {
              form.setValue("holdout", { id: holdoutId, value: "" });
            }}
            formType="feature"
          />
        )}

        {hasCommercialFeature("custom-metadata") &&
          customFields &&
          customFields?.length > 0 && (
            <div>
              <CustomFieldInput
                customFields={customFields}
                setCustomFields={(value) => {
                  form.setValue("customFields", value);
                }}
                currentCustomFields={form.watch("customFields") || {}}
                section={"feature"}
                project={selectedProject}
              />
            </div>
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

        {/*
          We hide rule configuration when duplicating a feature since the
          decision of which rule to display (out of potentially many) in the
          modal is not deterministic.
      */}
        {!featureToDuplicate && valueType && (
          <FeatureValueField
            label={
              <>
                Default Value when Enabled{" "}
                <Tooltip
                  body={
                    <>
                      After creating your feature, you will be able to add
                      targeted rules such as <strong>A/B Tests</strong> and{" "}
                      <strong>Percentage Rollouts</strong> to control exactly
                      how it gets released to users.
                    </>
                  }
                >
                  <PiInfo style={{ color: "var(--violet-11)" }} />
                </Tooltip>
              </>
            }
            id="defaultValue"
            value={form.watch("defaultValue")}
            setValue={(v) => form.setValue("defaultValue", v)}
            valueType={valueType}
            useCodeInput={true}
            showFullscreenButton={true}
          />
        )}

        <EnvironmentSelect
          environmentSettings={environmentSettings}
          environments={environments}
          setValue={(env, on) => {
            environmentSettings[env.id].enabled = on;
            form.setValue("environmentSettings", environmentSettings);
          }}
        />
      </FormProvider>
    </Modal>
  );
}
