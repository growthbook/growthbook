import {
  ExperimentInterfaceStringDates,
  ExperimentTargetingData,
  LinkedFeatureInfo,
} from "shared/types/experiment";
import { hasAttributeCondition } from "shared/experiments";
import { Box } from "@radix-ui/themes";
import LinkHashAttributeCallout from "@/components/Experiment/LinkHashAttributeCallout";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useAttributeSchema, useEnvironments } from "@/services/features";
import TargetingFieldsGroup from "@/components/Features/TargetingFieldsGroup";
import FallbackAttributeSelector from "@/components/Features/FallbackAttributeSelector";
import { formatAttributeOptionLabel } from "@/components/Features/AttributeOptionTooltip";
import SelectField from "@/components/Forms/SelectField";
import StickyBucketingToggle from "@/components/Experiment/StickyBucketingToggle";
import useOrgSettings from "@/hooks/useOrgSettings";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import HelperText from "@/ui/HelperText";
import {
  followAssignmentAttribute,
  getExposureQueriesInScope,
  getExposureQuery,
  getHashAttributeIdentifierTypeMap,
} from "@/services/datasources";
import track from "@/services/track";
import useSDKConnections from "@/hooks/useSDKConnections";
import SDKCapabilityWarning from "@/components/Features/SDKCapabilityWarning";
import NamespaceSelector from "@/components/Features/NamespaceSelector";
import type { StageTargeting } from "@/components/Experiment/TabbedPage/ExperimentEdits";
import HashVersionSelector, {
  allConnectionsSupportBucketingV2,
} from "./HashVersionSelector";
import MakeChangesFlow from "./MakeChangesFlow";
import {
  getLinkedExperimentAttributeScopes,
  useAttributeScopePicker,
} from "./useAttributeScopePicker";
import { useExperimentTargetingForm } from "./useExperimentTargetingForm";
import useHashAttributeOptions from "./useHashAttributeOptions";

export interface Props {
  section?: "targeting" | "namespace";
  close: () => void;
  experiment: ExperimentInterfaceStringDates;
  linkedFeatures?: LinkedFeatureInfo[];
  mutate: () => void;
  safeToEdit: boolean;
  /** Stages the confirmed change instead of writing it. */
  stageChanges?: StageTargeting;
  /** Targeting already staged, which the form opens on. */
  draft?: ExperimentTargetingData | null;
}

export default function EditTargetingModal({
  section = "targeting",
  close,
  experiment,
  linkedFeatures,
  mutate,
  safeToEdit,
  stageChanges,
  draft,
}: Props) {
  const { enforcement: enforcementScope, dropdown: dropdownScope } =
    getLinkedExperimentAttributeScopes(experiment.project, linkedFeatures);

  const {
    form,
    defaultValues,
    conditionKey,
    setPrerequisiteTargetingSdkIssues,
    canSubmit,
    onSubmit,
  } = useExperimentTargetingForm(experiment, enforcementScope, draft);

  const { effectiveAttributeProjects, attributeScopeToggle } =
    useAttributeScopePicker({
      project: experiment.project,
      scopeProjects: dropdownScope,
      allProjects: form.watch("attributeScopeAllProjects"),
      setAllProjects: (v) => form.setValue("attributeScopeAllProjects", v),
    });

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

  const attributeSchema = useAttributeSchema(false, effectiveAttributeProjects);
  const hashAttributeOptions = useHashAttributeOptions(
    effectiveAttributeProjects,
    form.watch("hashAttribute"),
  );

  const disableStickyBucketing = !!form.watch("disableStickyBucketing");
  const { getDatasourceById } = useDefinitions();
  const datasource = experiment.datasource
    ? getDatasourceById(experiment.datasource)
    : null;

  // Staged, a new assignment attribute brings the analysis the assignment
  // table and identifier type it's linked to, as the Data Source modal says.
  const hashAttribute = form.watch("hashAttribute");
  const followed =
    stageChanges && datasource && hashAttribute !== experiment.hashAttribute
      ? followAssignmentAttribute({
          queries: getExposureQueriesInScope(datasource, experiment.project),
          hashAttribute,
          hashAttributeIdentifierTypeMap: getHashAttributeIdentifierTypeMap(
            datasource.settings?.userIdTypes,
          ),
          exposureQueryId: experiment.exposureQueryId ?? "",
          identifierType: experiment.exposureQueryIdentifierType ?? "",
        })
      : null;

  const settings = useOrgSettings();

  const orgStickyBucketing = !!settings.useStickyBucketing;

  if (safeToEdit && section === "namespace") {
    return (
      <ModalStandard
        trackingEventModalType="edit-namespace-modal"
        open={true}
        close={close}
        header="Edit Namespace"
        subheader="Run mutually exclusive experiments within a shared namespace."
        ctaEnabled={canSubmit}
        cta={stageChanges ? "Confirm" : "Save"}
        submit={onSubmit(mutate, "namespace", stageChanges)}
        size="lg"
      >
        <NamespaceSelector
          form={form}
          featureId={experiment.trackingKey}
          trackingKey={experiment.trackingKey}
          experimentHashAttribute={form.watch("hashAttribute")}
          fallbackAttribute={form.watch("fallbackAttribute")}
          hideEnableToggle
        />
      </ModalStandard>
    );
  }

  if (safeToEdit) {
    return (
      <ModalStandard
        trackingEventModalType="edit-targeting-modal"
        open={true}
        close={close}
        header="Edit Targeting"
        ctaEnabled={canSubmit}
        cta={stageChanges ? "Confirm" : "Save"}
        submit={async () => {
          await onSubmit(mutate, "targeting", stageChanges)();
          trackAddedTargeting();
        }}
        size="lg"
      >
        <div className="pt-2">
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
            extraIndicator={attributeScopeToggle}
            options={hashAttributeOptions}
            sort={false}
            value={form.watch("hashAttribute")}
            onChange={(v) => {
              form.setValue("hashAttribute", v);
              // The fallback selector clears a match itself, but it isn't
              // always shown.
              if (v === form.getValues("fallbackAttribute")) {
                form.setValue("fallbackAttribute", "");
              }
            }}
            formatOptionLabel={formatAttributeOptionLabel}
            helpText={
              "Will be hashed together with the Tracking Key to determine which variation to assign"
            }
          />
          {followed ? (
            <HelperText status="warning" size="sm" mt="2">
              {followed.exposureQueryId !== experiment.exposureQueryId ? (
                <>
                  The experiment assignment table changes to{" "}
                  {getExposureQuery(
                    datasource?.settings,
                    followed.exposureQueryId,
                  )?.name ?? followed.exposureQueryId}{" "}
                  and the identifier type to{" "}
                </>
              ) : (
                "The identifier type changes to "
              )}
              <code>{followed.identifierType}</code> to match.
            </HelperText>
          ) : null}
          <LinkHashAttributeCallout
            experimentId={experiment.id}
            datasource={datasource}
            hashAttribute={form.watch("hashAttribute")}
            source="Edit Targeting"
          />
          {orgStickyBucketing ? (
            <StickyBucketingToggle
              my="6"
              disableStickyBucketing={disableStickyBucketing}
              setDisableStickyBucketing={(v) =>
                form.setValue("disableStickyBucketing", v)
              }
              description="Keep users in their assigned variation even when experiment traffic, targeting, or rollout settings change."
            />
          ) : null}
          {!disableStickyBucketing && (
            <FallbackAttributeSelector
              form={form}
              attributeSchema={attributeSchema}
              extraIndicator={attributeScopeToggle}
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

          <Box mt="6">
            <TargetingFieldsGroup
              project={experiment.project || ""}
              attributeProjects={effectiveAttributeProjects}
              attributeSelectIndicator={attributeScopeToggle}
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
      attributeProjects={dropdownScope}
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
