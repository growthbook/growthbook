import { useForm, UseFormReturn } from "react-hook-form";
import {
  ExperimentInterfaceStringDates,
  ExperimentPhaseStringDates,
  ExperimentTargetingData,
} from "shared/types/experiment";
import omit from "lodash/omit";
import isEqual from "lodash/isEqual";
import { useEffect, useMemo, useState } from "react";
import { validateAndFixCondition } from "shared/util";
import { getEqualWeights, getLatestPhaseVariations } from "shared/experiments";
import { Flex, Box } from "@radix-ui/themes";
import useSDKConnections from "@/hooks/useSDKConnections";
import { useIncrementer } from "@/hooks/useIncrementer";
import { useAuth } from "@/services/auth";
import { useAttributeSchema, useEnvironments } from "@/services/features";
import ReleaseChangesForm from "@/components/Experiment/ReleaseChangesForm";
import PagedModal from "@/components/Modal/PagedModal";
import Page from "@/components/Modal/Page";
import TargetingInfo from "@/components/Experiment/TabbedPage/TargetingInfo";
import FallbackAttributeSelector from "@/components/Features/FallbackAttributeSelector";
import {
  AttributeOptionWithTooltip,
  type AttributeOptionForTooltip,
} from "@/components/Features/AttributeOptionTooltip";
import { useDefinitions } from "@/services/DefinitionsContext";
import useOrgSettings from "@/hooks/useOrgSettings";
import PrerequisiteInput from "@/components/Features/PrerequisiteInput";
import FeatureVariationsInput from "@/components//Features/FeatureVariationsInput";
import ConditionInput from "@/components//Features/ConditionInput";
import NamespaceSelector from "@/components//Features/NamespaceSelector";
import SelectField from "@/components//Forms/SelectField";
import SavedGroupTargetingField, {
  validateSavedGroupTargeting,
} from "@/components/Features/SavedGroupTargetingField";
import Field from "@/components/Forms/Field";
import track from "@/services/track";
import RadioGroup, { RadioOptions } from "@/ui/RadioGroup";
import Checkbox from "@/ui/Checkbox";
import Callout from "@/ui/Callout";
import Text from "@/ui/Text";
import RemoveVariationsSection, {
  RemoveVariationDraftVariation,
  RemoveVariationMode,
} from "@/components/Experiment/RemoveVariationsSection";
import VariationSplitTable from "@/components/Experiment/VariationSplitTable";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import HashVersionSelector, {
  allConnectionsSupportBucketingV2,
} from "./HashVersionSelector";

export type ChangeType =
  | "targeting"
  | "traffic"
  | "weights"
  | "namespace"
  | "advanced"
  | "phase"
  | "remove-variation";

export type ReleasePlan =
  | "new-phase"
  | "same-phase-sticky"
  | "same-phase-everyone"
  | "new-phase-block-sticky" //advanced only
  | "new-phase-same-seed" // available from "new phase" only
  | "";

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
  const { apiCall } = useAuth();
  const [conditionKey, forceConditionRender] = useIncrementer();

  const [step, setStep] = useState(0);
  const [changeType, setChangeType] = useState<ChangeType | undefined>();
  const [releasePlan, setReleasePlan] = useState<ReleasePlan | undefined>();
  const [changesConfirmed, setChangesConfirmed] = useState(false);
  const [removeVariationMode, setRemoveVariationMode] =
    useState<RemoveVariationMode>("same-phase-skip");
  const [removeVariationDraft, setRemoveVariationDraft] = useState<
    RemoveVariationDraftVariation[]
  >([]);

  const { data: sdkConnectionsData } = useSDKConnections();
  const hasSDKWithNoBucketingV2 = !allConnectionsSupportBucketingV2(
    sdkConnectionsData?.connections,
    experiment.project,
  );

  const isBandit = experiment.type === "multi-armed-bandit";

  const [prerequisiteTargetingSdkIssues, setPrerequisiteTargetingSdkIssues] =
    useState(false);
  const canSubmit = !prerequisiteTargetingSdkIssues;

  const lastPhase: ExperimentPhaseStringDates | undefined =
    experiment.phases[experiment.phases.length - 1];

  const lastStepNumber = changeType !== "phase" ? 2 : 1;

  const lastPhaseVariations = useMemo(
    () => getLatestPhaseVariations(experiment),
    [experiment],
  );

  const defaultValues = {
    condition: lastPhase?.condition ?? "",
    savedGroups: lastPhase?.savedGroups ?? [],
    prerequisites: lastPhase?.prerequisites ?? [],
    coverage: lastPhase?.coverage ?? 1,
    hashAttribute: experiment.hashAttribute || "id",
    fallbackAttribute: experiment.fallbackAttribute || "",
    hashVersion: experiment.hashVersion || (hasSDKWithNoBucketingV2 ? 1 : 2),
    disableStickyBucketing: experiment.disableStickyBucketing ?? false,
    bucketVersion: experiment.bucketVersion || 1,
    minBucketVersion: experiment.minBucketVersion || 0,
    namespace: lastPhase?.namespace || {
      enabled: false,
      name: "",
      range: [0, 1],
    },
    seed: lastPhase?.seed ?? "",
    trackingKey: experiment.trackingKey || "",
    variationWeights:
      lastPhase?.variationWeights ??
      getEqualWeights(lastPhaseVariations.length, 4),
    variations:
      lastPhase?.variations ??
      lastPhaseVariations.map((v) => ({
        id: v.id,
        status: "active" as const,
      })),
    newPhase: false,
    reseed: true,
  };

  const form = useForm<ExperimentTargetingData>({
    defaultValues,
  });

  const _formValues = omit(form.watch(), [
    "newPhase",
    "reseed",
    "bucketVersion",
    "minBucketVersion",
  ]);
  const _defaultValues = omit(defaultValues, [
    "newPhase",
    "reseed",
    "bucketVersion",
    "minBucketVersion",
  ]);
  const hasChanges = !isEqual(_formValues, _defaultValues);
  /** Draft selections are authoritative; form sync runs in an effect so `getValues()` can lag one render. */
  const hasRemoveVariationChanges =
    changeType === "remove-variation" &&
    removeVariationDraft.some(
      (v) => !v.locked && (v.state === "passThrough" || v.state === "removed"),
    );
  const hasEffectiveChanges = hasChanges || hasRemoveVariationChanges;

  useEffect(() => {
    if (changeType !== "advanced") {
      form.reset();
    }
  }, [changeType, form]);

  useEffect(() => {
    if (changeType !== "remove-variation") return;
    const baseWeights =
      lastPhase?.variationWeights ??
      getEqualWeights(lastPhaseVariations.length, 4);
    setRemoveVariationDraft((current) => {
      const currentById = new Map(current.map((v) => [v.id, v]));
      return lastPhaseVariations.map((v, i) => {
        const existing = currentById.get(v.id);
        const locked = v.status === "passThrough";
        if (!existing) {
          return {
            id: v.id,
            index: v.index,
            name: v.name || `Variation ${v.index}`,
            key: v.key || v.index + "",
            originalWeight: baseWeights[i] ?? 0,
            weight: baseWeights[i] ?? 0,
            state: locked ? "passThrough" : "active",
            locked,
          };
        }
        return {
          ...existing,
          index: v.index,
          name: v.name || `Variation ${v.index}`,
          key: v.key || v.index + "",
          originalWeight: existing.originalWeight ?? baseWeights[i] ?? 0,
          weight: existing.weight ?? baseWeights[i] ?? 0,
          state: locked ? "passThrough" : existing.state,
          locked,
        };
      });
    });
  }, [changeType, lastPhase, lastPhaseVariations]);

  useEffect(() => {
    if (changeType !== "remove-variation") return;
    setRemoveVariationDraft((current) => {
      const next = current.map((v) => {
        if (v.locked) return v;
        if (
          removeVariationMode === "same-phase-skip" &&
          v.state === "removed"
        ) {
          return { ...v, state: "passThrough" as const };
        }
        if (
          removeVariationMode === "new-phase-rerandomize" &&
          v.state === "passThrough"
        ) {
          return { ...v, state: "removed" as const };
        }
        return v;
      });

      if (removeVariationMode === "same-phase-skip") {
        return next.map((v) => ({
          ...v,
          weight: v.originalWeight,
        }));
      }

      // Keep existing/original weights when switching into re-randomize mode.
      // Weight redistribution happens only when users explicitly change selections/splits.
      return next.map((v) => {
        if (v.state === "removed") return { ...v, weight: 0 };
        return { ...v, weight: v.weight ?? v.originalWeight };
      });
    });
  }, [changeType, removeVariationMode]);

  useEffect(() => {
    if (changeType !== "remove-variation") return;
    if (!removeVariationDraft.length) return;

    const selected = removeVariationDraft.filter(
      (v) =>
        v.state === "passThrough" ||
        (removeVariationMode === "new-phase-rerandomize" &&
          v.state === "removed"),
    );
    if (!selected.length) {
      form.setValue(
        "variations",
        lastPhase?.variations ??
          lastPhaseVariations.map((v) => ({
            id: v.id,
            status: "active" as const,
          })),
      );
      form.setValue(
        "variationWeights",
        lastPhase?.variationWeights ??
          getEqualWeights(lastPhaseVariations.length, 4),
      );
      return;
    }

    if (removeVariationMode === "same-phase-skip") {
      const nextVariations = removeVariationDraft.map((v) => ({
        id: v.id,
        status:
          v.state === "passThrough"
            ? ("passThrough" as const)
            : ("active" as const),
      }));

      form.setValue("variations", nextVariations, { shouldDirty: true });
      form.setValue(
        "variationWeights",
        removeVariationDraft.map((v) => v.weight),
        {
          shouldDirty: true,
        },
      );
    } else {
      const remaining = removeVariationDraft.filter(
        (v) => v.state !== "removed",
      );
      const nextVariations = remaining.map((v) => ({
        id: v.id,
        status: "active" as const,
      }));
      const weights = remaining.map((v) => v.weight);

      form.setValue("variations", nextVariations, { shouldDirty: true });
      form.setValue("variationWeights", weights, {
        shouldDirty: true,
      });
    }
  }, [
    changeType,
    form,
    lastPhaseVariations,
    removeVariationDraft,
    removeVariationMode,
    lastPhase,
  ]);

  useEffect(() => {
    if (step !== lastStepNumber) {
      if (changeType === "phase") {
        setReleasePlan("new-phase");
      } else if (changeType === "remove-variation") {
        setReleasePlan(
          removeVariationMode === "new-phase-rerandomize"
            ? "new-phase"
            : "same-phase-everyone",
        );
      } else {
        setReleasePlan("");
      }
      setChangesConfirmed(false);
    }
  }, [changeType, step, lastStepNumber, removeVariationMode, setReleasePlan]);

  const onSubmit = form.handleSubmit(async (value) => {
    validateSavedGroupTargeting(value.savedGroups);

    validateAndFixCondition(value.condition, (condition) => {
      form.setValue("condition", condition);
      forceConditionRender();
    });

    if (value.prerequisites) {
      if (value.prerequisites.some((p) => !p.id)) {
        throw new Error("Cannot have empty prerequisites");
      }
    }

    if (prerequisiteTargetingSdkIssues) {
      throw new Error("Prerequisite targeting issues must be resolved");
    }

    await apiCall(`/experiment/${experiment.id}/targeting`, {
      method: "POST",
      body: JSON.stringify(value),
    });
    mutate();
    track("edit-experiment-targeting", {
      type: changeType,
      action: releasePlan,
    });
  });

  if (safeToEdit) {
    return (
      <ModalStandard
        trackingEventModalType=""
        open={true}
        close={close}
        header={`Edit Targeting`}
        ctaEnabled={canSubmit}
        submit={onSubmit}
        cta="Save"
        size="lg"
      >
        <TargetingForm
          experiment={experiment}
          form={form}
          safeToEdit={true}
          conditionKey={conditionKey}
          removeVariationMode={removeVariationMode}
          setRemoveVariationMode={setRemoveVariationMode}
          removeVariationDraft={removeVariationDraft}
          setRemoveVariationDraft={setRemoveVariationDraft}
          setPrerequisiteTargetingSdkIssues={setPrerequisiteTargetingSdkIssues}
        />
      </ModalStandard>
    );
  }

  let cta = "Publish changes";
  let ctaEnabled = true;
  let blockSteps: number[] = [];
  if (!changeType) {
    cta = "Select a change type";
    ctaEnabled = false;
    blockSteps = [1, 2];
  } else {
    if (changeType !== "phase" && !hasEffectiveChanges) {
      if (step === 1) {
        cta = "No changes";
        ctaEnabled = false;
      }
      blockSteps = [lastStepNumber];
    }
    if (!releasePlan && step === lastStepNumber) {
      cta = "Select a release plan";
      ctaEnabled = false;
    }
    if (step == lastStepNumber && !changesConfirmed) {
      ctaEnabled = false;
    }
  }

  return (
    <PagedModal
      trackingEventModalType="make-changes"
      close={close}
      header={`Make ${isBandit ? "Bandit" : "Experiment"} Changes`}
      submit={onSubmit}
      cta={cta}
      ctaEnabled={ctaEnabled && canSubmit}
      forceCtaText={!ctaEnabled}
      size="lg"
      step={step}
      setStep={(i) => {
        if (!blockSteps.includes(i)) {
          setStep(i);
        }
      }}
      secondaryCTA={
        step === lastStepNumber ? (
          <Box style={{ minWidth: 520 }}>
            <Callout status="warning" contentsAs="div">
              <Flex align="center" justify="between" gap="3">
                <Text>
                  <Text weight="semibold">Warning:</Text> Changes made will
                  apply to linked Feature Flags, Visual Changes, and URL
                  Redirects immediately upon publishing
                </Text>
                <Box>
                  <label
                    htmlFor="confirm-changes"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      cursor: "pointer",
                    }}
                  >
                    <Text weight="semibold">Confirm</Text>
                    <input
                      id="confirm-changes"
                      type="checkbox"
                      checked={changesConfirmed}
                      onChange={(e) => setChangesConfirmed(e.target.checked)}
                    />
                  </label>
                </Box>
              </Flex>
            </Callout>
          </Box>
        ) : undefined
      }
    >
      <Page display="Type of Changes">
        <div className="py-2">
          <ChangeTypeSelector
            experiment={experiment}
            changeType={changeType}
            setChangeType={setChangeType}
          />

          <div className="mt-4">
            <label>Current targeting and traffic (for reference)</label>
            <div className="appbox bg-light px-3 pt-3 pb-1 mb-0">
              <TargetingInfo
                experiment={experiment}
                noHeader={true}
                targetingFieldsOnly={true}
                separateTrafficSplitDisplay={true}
                showDecimals={true}
                showNamespaceRanges={true}
              />
            </div>
          </div>
        </div>
      </Page>

      {changeType !== "phase" && (
        <Page display="Make Changes">
          <div>
            <TargetingForm
              experiment={experiment}
              form={form}
              safeToEdit={false}
              changeType={changeType}
              conditionKey={conditionKey}
              removeVariationMode={removeVariationMode}
              setRemoveVariationMode={setRemoveVariationMode}
              removeVariationDraft={removeVariationDraft}
              setRemoveVariationDraft={setRemoveVariationDraft}
              setPrerequisiteTargetingSdkIssues={
                setPrerequisiteTargetingSdkIssues
              }
            />
          </div>
        </Page>
      )}

      <Page display="Review & Deploy">
        <div className="mt-2">
          <ReleaseChangesForm
            experiment={experiment}
            form={form}
            changeType={changeType}
            releasePlan={releasePlan}
            setReleasePlan={setReleasePlan}
            removeVariationDraft={removeVariationDraft}
            removeVariationMode={removeVariationMode}
          />
        </div>
      </Page>
    </PagedModal>
  );
}

function ChangeTypeSelector({
  experiment,
  changeType,
  setChangeType,
}: {
  experiment: ExperimentInterfaceStringDates;
  changeType?: ChangeType;
  setChangeType: (changeType: ChangeType) => void;
}) {
  const { namespaces } = useOrgSettings();
  const removableVariations = getLatestPhaseVariations(experiment).filter(
    (v) => v.status !== "passThrough",
  );

  const options: RadioOptions = [
    { label: "Start a New Phase", value: "phase" },
    {
      label: "Saved Group, Attribute, and Prerequisite Targeting",
      value: "targeting",
    },
    {
      label: "Namespace Targeting",
      value: "namespace",
      disabled: !namespaces?.length,
    },
    { label: "Traffic Percent", value: "traffic" },
    ...(experiment.type !== "multi-armed-bandit"
      ? [{ label: "Variation Weights", value: "weights" }]
      : []),
    ...(experiment.type !== "multi-armed-bandit" &&
    removableVariations.length > 2
      ? [{ label: "Remove Variations", value: "remove-variation" }]
      : []),
    {
      label: "Advanced: multiple changes at once",
      value: "advanced",
      ...(experiment.type !== "multi-armed-bandit"
        ? {
            error: `When making multiple changes at the same time, it can be difficult to control for the impact of each change. 
              The risk of introducing experimental bias increases. Proceed with caution.`,
            errorLevel: "warning",
          }
        : {}),
    },
  ];

  return (
    <div>
      <h5>What do you want to change?</h5>
      <div className="mt-3">
        <RadioGroup
          value={changeType || ""}
          setValue={(v: ChangeType) => setChangeType(v)}
          options={options.filter((o) => !o.disabled)}
        />
      </div>
    </div>
  );
}

function TargetingForm({
  experiment,
  form,
  safeToEdit,
  changeType = "advanced",
  conditionKey,
  removeVariationMode,
  setRemoveVariationMode,
  removeVariationDraft,
  setRemoveVariationDraft,
  setPrerequisiteTargetingSdkIssues,
}: {
  experiment: ExperimentInterfaceStringDates;
  form: UseFormReturn<ExperimentTargetingData>;
  safeToEdit: boolean;
  changeType?: ChangeType;
  conditionKey: number;
  removeVariationMode: RemoveVariationMode;
  setRemoveVariationMode: (v: RemoveVariationMode) => void;
  removeVariationDraft: RemoveVariationDraftVariation[];
  setRemoveVariationDraft: React.Dispatch<
    React.SetStateAction<RemoveVariationDraftVariation[]>
  >;
  setPrerequisiteTargetingSdkIssues: (v: boolean) => void;
}) {
  const hasLinkedChanges =
    !!experiment.linkedFeatures?.length || !!experiment.hasVisualChangesets;

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

  // If the current hashAttribute isn't in the list, add it for backwards compatibility
  // this could happen if the hashAttribute has been archived, or removed from the experiment's project after the experiment was creaetd
  if (
    form.watch("hashAttribute") &&
    !hashAttributeOptions.find((o) => o.value === form.watch("hashAttribute"))
  ) {
    hashAttributeOptions.push({
      label: form.watch("hashAttribute"),
      value: form.watch("hashAttribute"),
    });
  }

  const settings = useOrgSettings();
  const { getDatasourceById } = useDefinitions();
  const datasource = experiment.datasource
    ? getDatasourceById(experiment.datasource)
    : null;
  const supportsSQL = datasource?.properties?.queryLanguage === "sql";

  const environments = useEnvironments();
  const envs = environments.map((e) => e.id);

  const type = experiment.type;

  const orgStickyBucketing = !!settings.useStickyBucketing;

  const phaseVariations = useMemo(
    () => getLatestPhaseVariations(experiment),
    [experiment],
  );

  return (
    <div className="pt-2">
      {safeToEdit && (
        <>
          <Field
            label="Tracking Key"
            labelClassName="font-weight-bold"
            {...form.register("trackingKey")}
            helpText={
              supportsSQL ? (
                <>
                  Unique identifier for this experiment, used to track
                  impressions and analyze results. Will match against the{" "}
                  <code>experiment_id</code> column in your data source.
                </>
              ) : (
                <>
                  Unique identifier for this experiment, used to track
                  impressions and analyze results. Must match the experiment id
                  in your tracking callback.
                </>
              )
            }
          />
          <SelectField
            withRadixThemedPortal
            containerClassName="flex-1"
            label="Assign variation based on attribute"
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
            helpText={"The globally unique tracking key for the experiment"}
          />
          <FallbackAttributeSelector
            form={form}
            attributeSchema={attributeSchema}
          />
          <HashVersionSelector
            value={form.watch("hashVersion")}
            onChange={(v) => form.setValue("hashVersion", v)}
            project={experiment.project}
          />

          {orgStickyBucketing ? (
            <Checkbox
              mt="4"
              size="lg"
              label="Disable Sticky Bucketing"
              description="Do not persist variation assignments for this experiment (overrides your organization settings)"
              value={!!form.watch("disableStickyBucketing")}
              setValue={(v) => {
                form.setValue("disableStickyBucketing", v === true);
              }}
            />
          ) : null}
        </>
      )}

      {(!hasLinkedChanges || safeToEdit) && <hr className="my-4" />}
      {!hasLinkedChanges && (
        <Callout status="info" mb="4">
          Changes made below are only metadata changes and will have no impact
          on actual experiment delivery unless you link a GrowthBook-managed
          Linked Feature or Visual Change to this experiment.
        </Callout>
      )}

      {["targeting", "advanced"].includes(changeType) && (
        <>
          <SavedGroupTargetingField
            value={form.watch("savedGroups") || []}
            setValue={(v) => form.setValue("savedGroups", v)}
            project={experiment.project || ""}
          />
          <hr />
          <ConditionInput
            defaultValue={form.watch("condition")}
            onChange={(condition) => form.setValue("condition", condition)}
            key={conditionKey}
            project={experiment.project || ""}
          />
          <hr />
          <PrerequisiteInput
            value={form.watch("prerequisites") || []}
            setValue={(prerequisites) =>
              form.setValue("prerequisites", prerequisites)
            }
            environments={envs}
            project={experiment.project}
            setPrerequisiteTargetingSdkIssues={
              setPrerequisiteTargetingSdkIssues
            }
          />
          {["advanced"].includes(changeType) && <hr />}
        </>
      )}

      {["namespace", "advanced"].includes(changeType) && (
        <>
          <NamespaceSelector
            form={form}
            featureId={experiment.trackingKey}
            trackingKey={experiment.trackingKey}
          />
          {["advanced"].includes(changeType) && <hr />}
        </>
      )}

      {["traffic", "weights", "advanced"].includes(changeType) &&
        (changeType === "advanced" ? (
          <>
            <FeatureVariationsInput
              valueType={"string"}
              coverage={form.watch("coverage")}
              setCoverage={(coverage) => form.setValue("coverage", coverage)}
              valueAsId={true}
              variations={phaseVariations.map((v, i) => ({
                value: v.key || i + "",
                name: v.name,
                weight: form.watch(`variationWeights.${i}`),
                id: v.id,
              }))}
              showPreview={false}
              hideVariations={true}
              label="Traffic Percentage"
            />
            {type !== "multi-armed-bandit" && (
              <VariationSplitTable
                label="Variation Weights"
                rows={phaseVariations}
                getRowKey={(v) => v.id}
                getWeightIndex={(row) =>
                  phaseVariations.findIndex((v) => v.id === row.id)
                }
                weights={phaseVariations.map((_, i) =>
                  form.watch(`variationWeights.${i}`),
                )}
                onApplyWeights={(next) => {
                  next.forEach((w, i) => {
                    form.setValue(`variationWeights.${i}`, w, {
                      shouldDirty: true,
                    });
                  });
                }}
                startEditingSplits={true}
                splitsAreEqual={(() => {
                  const wts = phaseVariations.map((_, i) =>
                    form.watch(`variationWeights.${i}`),
                  );
                  return (
                    wts.length <= 1 ||
                    wts.every((w) => Math.abs(w - wts[0]) < 0.0001)
                  );
                })()}
                onSetEqualWeights={() => {
                  const equal = getEqualWeights(phaseVariations.length, 4);
                  equal.forEach((w, i) => {
                    form.setValue(`variationWeights.${i}`, w, {
                      shouldDirty: true,
                    });
                  });
                }}
                renderVariationCell={(v) => (
                  <Flex
                    align="center"
                    className={`variation variation${v.index} with-variation-label`}
                    style={{ maxWidth: 200, flex: 1, minWidth: 0 }}
                  >
                    <span
                      className="label"
                      style={{
                        width: 20,
                        height: 20,
                        flex: "none",
                        marginTop: "-1px",
                      }}
                    >
                      {v.index}
                    </span>
                    <Text whiteSpace="normal">{v.name}</Text>
                  </Flex>
                )}
              />
            )}
          </>
        ) : (
          <FeatureVariationsInput
            valueType={"string"}
            coverage={form.watch("coverage")}
            setCoverage={(coverage) => form.setValue("coverage", coverage)}
            setWeight={(i, weight) =>
              form.setValue(`variationWeights.${i}`, weight)
            }
            valueAsId={true}
            variations={phaseVariations.map((v, i) => ({
              value: v.key || i + "",
              name: v.name,
              weight: form.watch(`variationWeights.${i}`),
              id: v.id,
            }))}
            showPreview={false}
            disableCoverage={changeType === "weights"}
            disableVariations={changeType === "traffic"}
            hideVariations={type === "multi-armed-bandit"}
            label={
              changeType === "traffic" || type === "multi-armed-bandit"
                ? "Traffic Percentage"
                : changeType === "weights"
                  ? "Variation Weights"
                  : "Traffic Percentage & Variation Weights"
            }
            startEditingSplits={true}
          />
        ))}

      {changeType === "remove-variation" && (
        <RemoveVariationsSection
          variations={removeVariationDraft}
          setVariations={setRemoveVariationDraft}
          mode={removeVariationMode}
          setMode={setRemoveVariationMode}
          usedViaRemoveVariation={true}
        />
      )}
    </div>
  );
}
