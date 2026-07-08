import { UseFormReturn, useWatch } from "react-hook-form";
import {
  ExperimentInterfaceStringDates,
  ExperimentTargetingData,
} from "shared/types/experiment";
import omit from "lodash/omit";
import isEqual from "lodash/isEqual";
import { useEffect, useMemo, useState } from "react";
import { getEqualWeights, getLatestPhaseVariations } from "shared/experiments";
import { Flex, Box } from "@radix-ui/themes";
import ReleaseChangesForm from "@/components/Experiment/ReleaseChangesForm";
import PagedModal from "@/components/Modal/PagedModal";
import Page from "@/components/Modal/Page";
import TargetingInfo from "@/components/Experiment/TabbedPage/TargetingInfo";
import useOrgSettings from "@/hooks/useOrgSettings";
import track from "@/services/track";
import RadioGroup, { RadioOptions } from "@/ui/RadioGroup";
import Callout from "@/ui/Callout";
import Text from "@/ui/Text";
import {
  RemoveVariationDraftVariation,
  RemoveVariationMode,
} from "@/components/Experiment/RemoveVariationsSection";
import TargetingForm from "./TargetingForm";

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

export interface MakeChangesFlowProps {
  experiment: ExperimentInterfaceStringDates;
  form: UseFormReturn<ExperimentTargetingData>;
  // Loosely typed because `useForm` accepts a `DeepPartial<ExperimentTargetingData>`
  // and the namespace shape produced by `EditTargetingModal` doesn't always match
  // the strict `ExperimentTargetingData` shape (legacy vs. multi-range namespaces).
  defaultValues: Record<string, unknown>;
  // Receives the selected change type as the validation scope so the shared
  // submit handler only validates the fields this flow actually rendered.
  onSubmit: (scope?: ChangeType) => Promise<void>;
  close: () => void;
  canSubmit: boolean;
  conditionKey: number;
  setPrerequisiteTargetingSdkIssues: (v: boolean) => void;
}

export default function MakeChangesFlow({
  experiment,
  form,
  defaultValues,
  onSubmit,
  close,
  canSubmit,
  conditionKey,
  setPrerequisiteTargetingSdkIssues,
}: MakeChangesFlowProps) {
  const [step, setStep] = useState(0);
  const [changeType, setChangeType] = useState<ChangeType | undefined>();
  const [releasePlan, setReleasePlan] = useState<ReleasePlan | undefined>();
  const [changesConfirmed, setChangesConfirmed] = useState(false);
  const [removeVariationMode, setRemoveVariationMode] =
    useState<RemoveVariationMode>("same-phase-skip");
  const [removeVariationDraft, setRemoveVariationDraft] = useState<
    RemoveVariationDraftVariation[]
  >([]);

  const isBandit = experiment.type === "multi-armed-bandit";

  const lastStepNumber = changeType !== "phase" ? 2 : 1;

  const lastPhase = experiment.phases[experiment.phases.length - 1];
  const lastPhaseVariations = useMemo(
    () => getLatestPhaseVariations(experiment),
    [experiment],
  );

  // useWatch so that form.setValue calls from NamespaceSelector (a child)
  // trigger a re-render here. Control flags are excluded because they're
  // mutated programmatically by the change-type step, not by the user.
  const watchedValues = useWatch({ control: form.control });
  const pickForCompare = <T extends Record<string, unknown>>(v: T) =>
    omit(v, ["newPhase", "reseed", "bucketVersion", "minBucketVersion"]);
  const hasChanges = !isEqual(
    pickForCompare(watchedValues),
    pickForCompare(defaultValues),
  );
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

  const submit = async () => {
    await onSubmit(changeType);
    track("edit-experiment-targeting", {
      type: changeType,
      action: releasePlan,
    });
  };

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
    if (step === lastStepNumber && !changesConfirmed) {
      ctaEnabled = false;
    }
  }

  return (
    <PagedModal
      useRadixButton={false}
      trackingEventModalType="make-changes"
      close={close}
      header={`Make ${isBandit ? "Bandit" : "Experiment"} Changes`}
      submit={submit}
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
