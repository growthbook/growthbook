import { useForm, FormProvider } from "react-hook-form";
import {
  FeatureEnvironment,
  FeatureInterface,
  FeatureValueType,
} from "shared/types/feature";
import {
  ClipboardSafeRolloutSettings,
  GrowthBookClipboardFeature,
} from "shared/validators";
import React, { ReactElement } from "react";
import { validateFeatureValue } from "shared/util";
import { PiInfo } from "react-icons/pi";
import { Box } from "@radix-ui/themes";
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
  onSuccess: (
    feature: FeatureInterface,
    options?: { draftVersion?: number },
  ) => Promise<void>;
  inline?: boolean;
  cta?: string;
  secondaryCTA?: ReactElement;
  featureToDuplicate?: FeatureInterface;
  featureToImport?: GrowthBookClipboardFeature;
  // Source-org safe-rollout settings indexed by source safeRolloutId — the
  // backend needs these to mint fresh SafeRollouts in the destination during
  // import. Lives one level up on the clipboard payload (not inside
  // `featureToImport`), so the importer forwards it as a separate prop.
  safeRolloutImportSettings?: Record<string, ClipboardSafeRolloutSettings>;
  features?: FeatureInterface[];
};

const genEnvironmentSettings = ({
  environments,
  featureToDuplicate,
  featureToImport,
  permissions,
  project,
}: {
  environments: ReturnType<typeof useEnvironments>;
  featureToDuplicate?: FeatureInterface;
  featureToImport?: GrowthBookClipboardFeature;
  permissions: ReturnType<typeof usePermissionsUtil>;
  project: string;
}): Record<string, FeatureEnvironment> => {
  const envSettings: Record<string, FeatureEnvironment> = {};

  environments.forEach((e) => {
    const canPublish = permissions.canPublishFeature({ project }, [e.id]);
    const defaultEnabled = canPublish ? (e.defaultState ?? true) : false;
    const enabled = featureToImport
      ? false
      : canPublish
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
  featureToImport,
  project,
  customFields,
}: {
  environments: ReturnType<typeof useEnvironments>;
  permissions: ReturnType<typeof usePermissionsUtil>;
  featureToDuplicate?: FeatureInterface;
  featureToImport?: GrowthBookClipboardFeature;
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
    featureToImport,
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

  const importedCustomFieldValues =
    customFields && featureToImport?.customFields
      ? {
          ...customFieldValues,
          ...Object.fromEntries(
            customFields
              .filter(
                (field) => field.id in (featureToImport.customFields ?? {}),
              )
              .map((field) => [
                field.id,
                featureToImport.customFields?.[field.id],
              ]),
          ),
        }
      : customFieldValues;

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
    : featureToImport
      ? {
          valueType: featureToImport.valueType,
          defaultValue: featureToImport.defaultValue,
          description: featureToImport.description ?? "",
          id: featureToImport.id,
          project: featureToImport.project ?? project,
          tags: featureToImport.tags ?? [],
          environmentSettings,
          rules: featureToImport.rules ?? [],
          customFields: importedCustomFieldValues,
          holdout: undefined,
          jsonSchema: featureToImport.jsonSchema,
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

export default function FeatureModal({
  close,
  onSuccess,
  inline,
  cta = "Create",
  secondaryCTA,
  featureToDuplicate,
  featureToImport,
  safeRolloutImportSettings,
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

  const defaultValues = genFormDefaultValues({
    environments,
    permissions: permissionsUtil,
    featureToDuplicate,
    featureToImport,
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
  const environmentSettings = form.watch("environmentSettings");
  const rules = form.watch("rules") ?? [];
  const isImport = !!featureToImport;

  const modalHeader = isImport
    ? "Import Feature Configuration"
    : featureToDuplicate
      ? `Duplicate Feature (${featureToDuplicate.id})`
      : "Create Feature";

  let ctaEnabled = true;
  let disabledMessage: string | undefined;

  // Duplicate locks the project to the source feature; create / import follow
  // whatever the user picked in the selector.
  const projectForPermissionCheck =
    featureToDuplicate?.project ?? selectedProject;
  if (
    !permissionsUtil.canManageFeatureDrafts({
      project: projectForPermissionCheck,
    }) ||
    !permissionsUtil.canCreateFeature({ project: projectForPermissionCheck })
  ) {
    ctaEnabled = false;
    disabledMessage =
      !selectedProject && projectOptions.length > 0
        ? "Select a project to continue."
        : "You don't have permission to create features in this project.";
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

        // When duplicating or importing, skip JSON schema validation since
        // the value is copied verbatim from an existing valid feature and the
        // user cannot edit it in this modal. Running validateFeatureValue
        // with the full feature can "fix" an already-valid value and force
        // the confusing two-submit dance.
        const featureForValidation =
          featureToDuplicate || featureToImport
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

        const createEnvironmentSettings = isImport
          ? Object.fromEntries(
              Object.entries(feature.environmentSettings).map(
                ([env, settings]) => [env, { ...settings, enabled: false }],
              ),
            )
          : feature.environmentSettings;
        const body = {
          ...feature,
          rules: isImport ? [] : feature.rules,
          environmentSettings: createEnvironmentSettings,
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

        let draftVersion: number | undefined;
        if (isImport) {
          try {
            const importDraftRes = await apiCall<{
              status: 200;
              draftVersion: number;
            }>(`/feature/${res.feature.id}/import-draft`, {
              method: "POST",
              body: JSON.stringify({
                rules: feature.rules,
                environmentsEnabled: Object.fromEntries(
                  Object.keys(createEnvironmentSettings).map((env) => [
                    env,
                    true,
                  ]),
                ),
                // Source-org SafeRollout settings; the backend mints fresh
                // destination SafeRollouts from these and rewrites
                // rule.safeRolloutId. Omitting this would cause the
                // import-draft endpoint to throw for any safe-rollout rule.
                safeRolloutSettings: safeRolloutImportSettings,
                title: "Imported feature configuration",
                comment:
                  "Imported from a copied GrowthBook feature configuration.",
              }),
            });
            draftVersion = importDraftRes.draftVersion;
          } catch (e) {
            // The live feature was created but the draft with the imported
            // rules failed — clean up so the user isn't left with an empty,
            // permanently-disabled feature. DELETE /feature/:id only accepts
            // archived features, so archive first.  Surface the original
            // error regardless of cleanup outcome.
            try {
              await apiCall(`/feature/${res.feature.id}/archive`, {
                method: "POST",
                body: JSON.stringify({ archived: true }),
              });
              await apiCall(`/feature/${res.feature.id}`, {
                method: "DELETE",
              });
            } catch {
              // If cleanup fails (archive or delete), fall through and
              // surface the original error. The orphan feature can be cleaned
              // up manually from the Features list.
            }
            throw e;
          }
        }

        track("Feature Created", {
          valueType: values.valueType,
          hasDescription: !!values.description?.length,
          initialRule:
            isImport && feature.rules?.length ? "imported-draft" : "none",
        });
        values.tags && refreshTags(values.tags);
        refreshWatching();

        await onSuccess(res.feature, { draftVersion });
      })}
    >
      <FormProvider {...form}>
        {isImport && (
          <Callout status="info" mb="3">
            This will create the live feature with all environments disabled,
            then create a draft revision with {rules.length} imported{" "}
            {rules.length === 1 ? "rule" : "rules"} and all environments
            enabled. No rules will be published until you review and publish the
            draft.
          </Callout>
        )}
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

        {!featureToDuplicate && !featureToImport && (
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

        {isImport ? (
          <Callout status="info" mb="4">
            The draft created by this import will enable all environments. You
            can review or change those environment toggles before publishing.
          </Callout>
        ) : (
          <EnvironmentSelect
            environmentSettings={environmentSettings}
            environments={environments}
            project={selectedProject}
            setValue={(env, on) => {
              environmentSettings[env.id].enabled = on;
              form.setValue("environmentSettings", environmentSettings);
            }}
          />
        )}

        <div className="mb-4">
          <label>Description</label>
          <Box mt="1">
            <MarkdownInput
              value={form.watch("description") || ""}
              setValue={(value) => form.setValue("description", value)}
              // Autofocus only when there's no preexisting description to
              // read — pre-populated content (from duplicate or import) means
              // the user is more likely reviewing than typing, and focusing
              // the editor scrolls the modal past the informational callouts.
              autofocus={
                !featureToDuplicate?.description?.length &&
                !featureToImport?.description?.length
              }
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
