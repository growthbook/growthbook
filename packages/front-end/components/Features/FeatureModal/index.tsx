import { useForm, FormProvider } from "react-hook-form";
import {
  FeatureEnvironment,
  FeatureInterface,
  FeatureValueType,
  SimpleSchema,
} from "shared/types/feature";
import React, { ReactElement, useState } from "react";
import {
  getJSONValidator,
  inferSimpleSchemaFromValue,
  simpleToJSONSchema,
  validateFeatureValue,
} from "shared/util";
import { PiInfo } from "react-icons/pi";
import { Box } from "@radix-ui/themes";
import { EditSimpleSchema } from "@/components/Features/EditSchemaModal";
import Heading from "@/ui/Heading";
import Frame from "@/ui/Frame";
import PaidFeatureBadge from "@/components/GetStarted/PaidFeatureBadge";
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
import Callout from "@/ui/Callout";
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

    envSettings[e.id] = { enabled };
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
  | "rules"
  | "customFields"
  | "holdout"
  | "jsonSchema"
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
        rules: featureToDuplicate.rules ?? [],
        customFields: customFieldValues,
        holdout: featureToDuplicate.holdout?.id
          ? featureToDuplicate.holdout
          : undefined,
        jsonSchema: featureToDuplicate.jsonSchema,
      }
    : {
        valueType: "" as FeatureValueType,
        defaultValue: getDefaultValue("boolean"),
        description: "",
        id: "",
        project,
        tags: [],
        environmentSettings,
        rules: [],
        customFields: customFieldValues,
        holdout: undefined,
      };
};

type ExtendedFeatureValueType = FeatureValueType | "custom";

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
  const hasJsonValidator = hasCommercialFeature("json-validation");
  const [useSchemaCreator, setUseSchemaCreator] = useState(false);
  const [simpleSchema, setSimpleSchema] = useState<SimpleSchema>(() =>
    inferSimpleSchemaFromValue("{}"),
  );

  const allCustomFields = useCustomFields();
  const initialCustomFields = filterCustomFieldsForSectionAndProject(
    allCustomFields,
    "feature",
    project,
  );

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
  const canCreateWithoutProject =
    !requireProjectForFeatures && permissionsUtil.canViewFeatureModal();
  const selectedProject = form.watch("project");
  const customFields = filterCustomFieldsForSectionAndProject(
    allCustomFields,
    "feature",
    selectedProject,
  );
  const { projectId: demoProjectId } = useDemoDataSourceProject();
  const { apiCall } = useAuth();

  const valueType = form.watch("valueType") as FeatureValueType;
  const flagValueType = form.watch("valueType") as ExtendedFeatureValueType;
  const environmentSettings = form.watch("environmentSettings");

  const usingJsonSchema =
    flagValueType === "custom" ||
    (flagValueType === "json" && useSchemaCreator);

  const modalHeader = featureToDuplicate
    ? `Duplicate Feature (${featureToDuplicate.id})`
    : "Create Feature";

  let ctaEnabled = true;
  let disabledMessage: string | undefined;

  if (
    !permissionsUtil.canManageFeatureDrafts({
      project: featureToDuplicate?.project ?? selectedProject,
    })
  ) {
    ctaEnabled = false;
    disabledMessage =
      !selectedProject && projectOptions.length > 0
        ? "Select a project to continue."
        : "You don't have permission to create feature flag drafts.";
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
        let valueType = feature.valueType as ExtendedFeatureValueType;
        const { holdout } = feature;

        if (!valueType) {
          throw new Error("Please select a value type");
        }

        const hasSchema =
          valueType === "custom" || (valueType === "json" && useSchemaCreator);

        // "custom" is a UI-only value type; persist as "json".
        if (valueType === "custom") {
          valueType = "json";
          feature.valueType = "json";
        }

        if (hasSchema && hasJsonValidator) {
          const schemaString = simpleToJSONSchema(simpleSchema);
          try {
            const parsedSchema = JSON.parse(schemaString);
            const ajv = getJSONValidator();
            ajv.compile(parsedSchema);
          } catch (e) {
            throw new Error(
              `The Simple Schema is invalid. Please check it and try again. Validator error: "${e.message}"`,
            );
          }
          feature.jsonSchema = {
            date: new Date(),
            schemaType: "simple",
            schema: schemaString,
            simple: simpleSchema,
            enabled: true,
          };
        }

        // When duplicating, skip JSON schema validation since the value is
        // copied verbatim from an existing feature and the user cannot edit it.
        const featureForValidation = featureToDuplicate
          ? { valueType: feature.valueType }
          : feature;
        const newDefaultValue = validateFeatureValue(
          featureForValidation,
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
          <Callout status="warning" mb="3">
            You are creating a feature under the demo datasource project.
          </Callout>
        )}

        <FeatureKeyField keyField={form.register("id")} />

        {projectOptions.length > 0 && (
          <>
            {selectedProject === demoProjectId && (
              <Callout status="warning" mb="3">
                You are creating a feature under the demo datasource project.
              </Callout>
            )}
            <SelectField
              label={
                <>
                  Project{" "}
                  <Tooltip body="The dropdown below has been filtered to only include projects where you have permission to update Features" />
                </>
              }
              value={selectedProject || ""}
              onChange={(v) => {
                form.setValue("project", v);
              }}
              initialOption={canCreateWithoutProject ? "None" : undefined}
              options={projectOptions}
              required={requireProjectForFeatures}
            />
          </>
        )}

        <TagsField
          value={form.watch("tags") || []}
          onChange={(tags) => form.setValue("tags", tags)}
        />

        <HoldoutSelect
          selectedProject={selectedProject}
          selectedHoldoutId={form.watch("holdout")?.id}
          setHoldout={(holdoutId) => {
            form.setValue("holdout", { id: holdoutId, value: "" });
          }}
          formType="feature"
        />

        {!featureToDuplicate && (
          <>
            <ValueTypeField
              value={valueType}
              onChange={(val) => {
                const defaultValue = getDefaultValue(val);
                form.setValue("valueType", val);
                form.setValue("defaultValue", defaultValue);
              }}
              useCustom={true}
            />
            {flagValueType === "json" && (
              <Box
                style={{
                  position: "relative",
                  top: "-15px",
                  textAlign: "right",
                }}
              >
                <a
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    if (!hasJsonValidator) return;
                    setUseSchemaCreator(!useSchemaCreator);
                  }}
                >
                  <span style={{ fontSize: "12px" }}>
                    {!useSchemaCreator || !hasJsonValidator
                      ? "Add validation"
                      : "Remove validation"}
                  </span>
                  <PaidFeatureBadge commercialFeature={"json-validation"} />
                </a>
              </Box>
            )}
          </>
        )}

        {!featureToDuplicate && hasJsonValidator && usingJsonSchema && (
          <Box mb="3">
            <Heading as="h4" size="x-small">
              Describe the values allowed in this feature flag.{" "}
              <Tooltip
                body={
                  "Custom feature flag types let you describe the values that are allowed to be passed to your code. Feature types of this type will use a JSON object with custom JSON validation. This can be edited at any time after creation."
                }
              >
                <PiInfo style={{ color: "var(--violet-11)" }} />
              </Tooltip>
            </Heading>
            <Frame>
              <EditSimpleSchema
                schema={simpleSchema}
                setSchema={(v) => setSimpleSchema(v)}
              />
            </Frame>
          </Box>
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
            valueType={flagValueType === "custom" ? "json" : valueType}
            useCodeInput={true}
            showFullscreenButton={true}
            renderJSONInline={usingJsonSchema && hasJsonValidator}
            initialSimpleSchema={
              usingJsonSchema && hasJsonValidator ? simpleSchema : undefined
            }
            initialValidationEnabled={usingJsonSchema && hasJsonValidator}
          />
        )}

        <EnvironmentSelect
          environmentSettings={environmentSettings}
          environments={environments}
          project={selectedProject}
          setValue={(env, on) => {
            environmentSettings[env.id].enabled = on;
            form.setValue("environmentSettings", environmentSettings);
          }}
        />

        <div className="mb-4">
          <label>Description</label>
          <Box mt="1">
            <MarkdownInput
              value={form.watch("description") || ""}
              setValue={(value) => form.setValue("description", value)}
              autofocus={!featureToDuplicate?.description?.length}
            />
          </Box>
        </div>

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
      </FormProvider>
    </Modal>
  );
}
