import { FormProvider } from "react-hook-form";
import { FeatureInterface, FeatureValueType } from "shared/types/feature";
import { ReactElement } from "react";
import { validateFeatureValue } from "shared/util";
import { PiInfo } from "react-icons/pi";
import { HoldoutSelect } from "@/components/Holdout/HoldoutSelect";
import Modal from "@/components/Modal";
import track from "@/services/track";
import {
  genDuplicatedKey,
  getDefaultValue,
  parseDefaultValue,
} from "@/services/features";
import Tooltip from "@/components/Tooltip/Tooltip";
import { useDemoDataSourceProject } from "@/hooks/useDemoDataSourceProject";
import FeatureValueField from "@/components/Features/FeatureValueField";
import useProjectOptions from "@/hooks/useProjectOptions";
import useOrgSettings from "@/hooks/useOrgSettings";
import SelectField from "@/components/Forms/SelectField";
import Callout from "@/ui/Callout";
import { useFeatureForm } from "@/hooks/useFeatureForm";
import FeatureFormFields from "./FeatureFormFields";
import { CreateFeatureFormValues } from "./FeatureFormTypes";

export type Props = {
  close?: () => void;
  onSuccess: (feature: FeatureInterface) => Promise<void>;
  inline?: boolean;
  cta?: string;
  secondaryCTA?: ReactElement;
  featureToDuplicate?: FeatureInterface;
  features?: FeatureInterface[];
};

const genInitialValues = ({
  featureToDuplicate,
}: {
  featureToDuplicate?: FeatureInterface;
}): Omit<CreateFeatureFormValues, "environmentSettings" | "customFields"> & {
  customFields?: Record<string, unknown>;
} => {
  return featureToDuplicate
    ? {
        valueType: featureToDuplicate.valueType,
        defaultValue: featureToDuplicate.defaultValue,
        description: featureToDuplicate.description ?? "",
        id: genDuplicatedKey(featureToDuplicate),
        project: featureToDuplicate.project ?? "",
        tags: featureToDuplicate.tags ?? [],
        customFields: featureToDuplicate.customFields,
        holdout: featureToDuplicate.holdout?.id
          ? featureToDuplicate.holdout
          : undefined,
      }
    : {
        valueType: "",
        defaultValue: getDefaultValue("boolean"),
        description: "",
        id: "",
        tags: [],
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
  const { requireProjectForFeatures } = useOrgSettings();
  const {
    form,
    environments,
    currentProject,
    permissionsUtil,
    apiCall,
    refreshTags,
    refreshWatching,
    serializeCustomFields,
    canManageDrafts,
    getEnvironmentSettingsForProject,
  } = useFeatureForm<CreateFeatureFormValues>({
    initialValues: genInitialValues({
      featureToDuplicate,
    }),
    baseEnvironmentSettings: featureToDuplicate?.environmentSettings,
  });

  const projectOptions = useProjectOptions(
    (project) =>
      permissionsUtil.canCreateFeature({ project }) &&
      permissionsUtil.canManageFeatureDrafts({ project }),
    currentProject ? [currentProject] : [],
  );
  const canCreateWithoutProject =
    !requireProjectForFeatures && permissionsUtil.canViewFeatureModal();
  const selectedProject = form.watch("project");
  const { projectId: demoProjectId } = useDemoDataSourceProject();

  const valueType = form.watch("valueType") as FeatureValueType;

  const modalHeader = featureToDuplicate
    ? `Duplicate Feature (${featureToDuplicate.id})`
    : "Create Feature";

  let ctaEnabled = true;
  let disabledMessage: string | undefined;

  if (!canManageDrafts(featureToDuplicate?.project ?? selectedProject)) {
    ctaEnabled = false;
    disabledMessage =
      !selectedProject && projectOptions.length > 0
        ? "Select a project to continue."
        : "You don't have permission to create feature flag drafts.";
  }

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

        const featureWithValueType = { ...feature, valueType };
        const newDefaultValue = validateFeatureValue(
          featureWithValueType,
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

        const serializedCustomFields = serializeCustomFields(
          feature.project,
          feature.customFields,
        );

        const body = {
          ...featureWithValueType,
          customFields: serializedCustomFields,
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
        <FeatureFormFields
          initialShowTags={true}
          initialShowDescription={true}
          descriptionAutofocus={!featureToDuplicate?.description?.length}
          afterDescription={
            <>
              {selectedProject === demoProjectId && (
                <Callout status="warning" mb="3">
                  You are creating a feature under the demo datasource project.
                </Callout>
              )}
              {projectOptions.length > 0 && (
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
                    form.setValue(
                      "environmentSettings",
                      getEnvironmentSettingsForProject(v),
                    );
                  }}
                  initialOption={canCreateWithoutProject ? "None" : undefined}
                  options={projectOptions}
                  required={requireProjectForFeatures}
                />
              )}
              <HoldoutSelect
                selectedProject={selectedProject}
                selectedHoldoutId={form.watch("holdout")?.id}
                setHoldout={(holdoutId) => {
                  form.setValue("holdout", { id: holdoutId, value: "" });
                }}
                formType="feature"
              />
            </>
          }
          showValueType={!featureToDuplicate}
          onValueTypeChange={(val) => {
            const defaultValue = getDefaultValue(val);
            form.setValue("valueType", val);
            form.setValue("defaultValue", defaultValue);
          }}
          afterValueType={
            /*
              We hide rule configuration when duplicating a feature since the
              decision of which rule to display (out of potentially many) in the
              modal is not deterministic.
            */
            !featureToDuplicate &&
            valueType && (
              <FeatureValueField
                label={
                  <>
                    Default Value when Enabled{" "}
                    <Tooltip
                      body={
                        <>
                          After creating your feature, you will be able to add
                          targeted rules such as <strong>A/B Tests</strong> and{" "}
                          <strong>Percentage Rollouts</strong> to control
                          exactly how it gets released to users.
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
            )
          }
          environments={environments}
        />
      </FormProvider>
    </Modal>
  );
}
