import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { hasAttributeCondition } from "shared/experiments";
import { Box } from "@radix-ui/themes";
import { useFeatureIsOn } from "@growthbook/growthbook-react";
import { useAttributeSchema, useEnvironments } from "@/services/features";
import TargetingFieldsGroup from "@/components/Features/TargetingFieldsGroup";
import FallbackAttributeSelector from "@/components/Features/FallbackAttributeSelector";
import {
  AttributeOptionWithTooltip,
  type AttributeOptionForTooltip,
} from "@/components/Features/AttributeOptionTooltip";
import SelectField from "@/components/Forms/SelectField";
import Switch from "@/ui/Switch";
import useOrgSettings from "@/hooks/useOrgSettings";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import Text from "@/ui/Text";
import track from "@/services/track";
import useSDKConnections from "@/hooks/useSDKConnections";
import SDKCapabilityWarning from "@/components/Features/SDKCapabilityWarning";
import HashVersionSelector, {
  allConnectionsSupportBucketingV2,
} from "./HashVersionSelector";
import MakeChangesFlow from "./MakeChangesFlow";
import { useExperimentTargetingForm } from "./useExperimentTargetingForm";

export interface Props {
  close: () => void;
  experiment: ExperimentInterfaceStringDates;
  mutate: () => void;
  safeToEdit: boolean;
}

export default function EditTargetingModal({
  close,
  experiment,
  mutate,
  safeToEdit,
}: Props) {
  const {
    form,
    defaultValues,
    conditionKey,
    setPrerequisiteTargetingSdkIssues,
    canSubmit,
    onSubmit,
  } = useExperimentTargetingForm(experiment);

  const environments = useEnvironments();
  const envs = environments.map((e) => e.id);

  const latestPhase = experiment.phases[experiment.phases.length - 1];

  // Fire once on a successful save when targeting was newly added
  const trackAddedTargeting = () => {
    const values = form.getValues();
    const conditionAdded =
      !hasAttributeCondition(latestPhase?.condition) &&
      hasAttributeCondition(values.condition);
    const savedGroupsAdded =
      (values.savedGroups?.length ?? 0) >
      (latestPhase?.savedGroups?.length ?? 0);
    const prerequisitesAdded =
      (values.prerequisites?.length ?? 0) >
      (latestPhase?.prerequisites?.length ?? 0);

    if (conditionAdded || savedGroupsAdded || prerequisitesAdded) {
      track("Added targeting", {
        conditionAdded,
        savedGroupsAdded,
        prerequisitesAdded,
      });
    }
  };

  const { data: sdkConnectionsData, isLoading: sdkConnectionsLoading } =
    useSDKConnections();
  const hasSDKWithNoBucketingV2 = !allConnectionsSupportBucketingV2(
    sdkConnectionsData?.connections,
    experiment.project,
  );

  const attributeSchema = useAttributeSchema(false, experiment.project);
  const hasHashAttributes =
    attributeSchema.filter((x) => x.hashAttribute).length > 0;

  const hashAttributeOptions: AttributeOptionForTooltip[] = attributeSchema
    .filter((s) => !hasHashAttributes || s.hashAttribute)
    .map((s) => ({
      label: s.property,
      value: s.property,
      description: s.description,
      tags: s.tags,
      datatype: s.datatype,
      hashAttribute: s.hashAttribute,
    }));

  // If the current hashAttribute isn't in the list, add it for backwards
  // compatibility (e.g. the attribute was archived or removed from the
  // experiment's project after creation).
  if (
    form.watch("hashAttribute") &&
    !hashAttributeOptions.find((o) => o.value === form.watch("hashAttribute"))
  ) {
    hashAttributeOptions.push({
      label: form.watch("hashAttribute"),
      value: form.watch("hashAttribute"),
    });
  }

  const disableStickyBucketing = !!form.watch("disableStickyBucketing");

  const settings = useOrgSettings();

  const orgStickyBucketing = !!settings.useStickyBucketing;

  const simpleExperimentFlow = useFeatureIsOn("simple-experiment-flow");

  if (safeToEdit) {
    return (
      <ModalStandard
        trackingEventModalType="edit-targeting-modal"
        open={true}
        close={close}
        header="Edit Targeting"
        ctaEnabled={canSubmit}
        submit={async () => {
          await onSubmit(mutate, "targeting")();
          trackAddedTargeting();
        }}
        size="lg"
      >
        <div className="pt-2">
          {simpleExperimentFlow ? (
            <>
              {experiment.hashVersion === 1 && (
                <SDKCapabilityWarning
                  capability="bucketingV2"
                  project={experiment.project}
                  someMessage="Using V1 hashing algorithm as some of your SDK Connections may not support V2 hashing."
                  noneMessage="Using V1 hashing algorithm as none of your SDK Connections support V2 hashing."
                  popoverTriggerText="Show incompatible SDKs"
                  size="medium"
                  mb="6"
                />
              )}
              <SelectField
                withRadixThemedPortal
                containerClassName="flex-1"
                label="Assignment Attribute"
                labelClassName="font-weight-bold"
                options={hashAttributeOptions}
                sort={false}
                value={form.watch("hashAttribute")}
                onChange={(v) => {
                  form.setValue("hashAttribute", v);
                }}
                formatOptionLabel={(o, meta) => {
                  return (
                    <AttributeOptionWithTooltip
                      option={o as AttributeOptionForTooltip}
                      context={meta.context}
                    >
                      {o.label}
                    </AttributeOptionWithTooltip>
                  );
                }}
                helpText={
                  "Will be hashed together with the Tracking Key to determine which variation to assign"
                }
              />
              {orgStickyBucketing ? (
                <Switch
                  my="6"
                  label={
                    <>
                      <Text weight="medium" color="text-high">
                        Sticky Bucketing
                      </Text>{" "}
                      <Text color="text-high">
                        (Organization default: Enabled)
                      </Text>
                    </>
                  }
                  description="Keep users in their assigned variation even when experiment traffic, targeting, or rollout settings change."
                  value={!form.watch("disableStickyBucketing")}
                  onChange={(v) => {
                    form.setValue("disableStickyBucketing", !v);
                  }}
                />
              ) : null}
              {!disableStickyBucketing && (
                <FallbackAttributeSelector
                  form={form}
                  attributeSchema={attributeSchema}
                />
              )}
              {!sdkConnectionsLoading &&
                !hasSDKWithNoBucketingV2 &&
                experiment.hashVersion === 1 && (
                  <HashVersionSelector
                    value={form.watch("hashVersion")}
                    onChange={(v) => form.setValue("hashVersion", v)}
                    project={experiment.project}
                  />
                )}
            </>
          ) : null}

          <Box mt={simpleExperimentFlow ? "6" : "0"}>
            <TargetingFieldsGroup
              project={experiment.project || ""}
              environments={envs}
              savedGroups={form.watch("savedGroups") || []}
              setSavedGroups={(v) => form.setValue("savedGroups", v)}
              condition={form.watch("condition")}
              setCondition={(condition) =>
                form.setValue("condition", condition)
              }
              conditionKey={conditionKey}
              prerequisites={form.watch("prerequisites") || []}
              setPrerequisites={(prerequisites) =>
                form.setValue("prerequisites", prerequisites)
              }
              setPrerequisiteTargetingSdkIssues={
                setPrerequisiteTargetingSdkIssues
              }
            />
          </Box>
        </div>
      </ModalStandard>
    );
  }

  return (
    <MakeChangesFlow
      experiment={experiment}
      form={form}
      defaultValues={defaultValues}
      onSubmit={(scope) => onSubmit(mutate, scope)()}
      close={close}
      canSubmit={canSubmit}
      conditionKey={conditionKey}
      setPrerequisiteTargetingSdkIssues={setPrerequisiteTargetingSdkIssues}
    />
  );
}
