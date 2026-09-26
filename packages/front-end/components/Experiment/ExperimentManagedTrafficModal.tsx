import { useForm } from "react-hook-form";
import {
  ExperimentInterfaceStringDates,
  ExperimentPhaseStringDates,
  LinkedFeatureInfo,
} from "shared/types/experiment";
import { getEqualWeights, getLatestPhaseVariations } from "shared/experiments";
import { FeatureValueType } from "shared/types/feature";
import {
  castFeatureValue,
  getImplementationType,
  getReviewSetting,
  isManagedByExperiment,
  validateFeatureValue,
  type ManagedFlagKeyPlan,
} from "shared/util";
import { Box, Flex } from "@radix-ui/themes";
import { useEffect, useMemo, useRef, useState } from "react";
import ValueTypeField from "@/components/Features/FeatureModal/ValueTypeField";
import {
  blockedExperimentValueTypes,
  EXPERIMENT_VALUE_TYPE_ORDER,
} from "@/components/Features/valueTypes";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import useApi from "@/hooks/useApi";
import useOrgSettings from "@/hooks/useOrgSettings";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import { distributeWeights } from "@/services/utils";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import Link from "@/ui/Link";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import Metadata from "@/ui/Metadata";
import Text from "@/ui/Text";
import Field from "@/components/Forms/Field";
import track from "@/services/track";
import EditTrafficModal from "./EditTrafficModal";
import ExperimentManagedFeatureVariationEditor from "./ExperimentManagedFeatureVariationEditor";
import { ManagedSortableVariation } from "./ExperimentManagedFeatureVariationRow";

export interface Props {
  close: () => void;
  experiment: ExperimentInterfaceStringDates;
  linkedFeatures?: LinkedFeatureInfo[];
  mutate: () => void;
  safeToEdit: boolean;
  focusVariationId?: string | null;
  addVariationOnOpen?: boolean;
}

// A fork of `EditTrafficModal` for flag-only experiments.
export default function ExperimentManagedTrafficModal({
  close,
  experiment,
  linkedFeatures,
  mutate,
  safeToEdit,
  focusVariationId,
  addVariationOnOpen,
}: Props) {
  const permissionsUtil = usePermissionsUtil();
  const managedFeature =
    (linkedFeatures ?? []).find((f) =>
      isManagedByExperiment(f.feature, experiment.id),
    ) ?? null;

  // A Value column can only name "the" flag when there is exactly one.
  const soleFeature =
    (linkedFeatures ?? []).length === 1 &&
    !experiment.hasVisualChangesets &&
    !experiment.hasURLRedirects
      ? (linkedFeatures ?? [])[0]
      : null;

  // An unmanaged sole flag is edited here only while the experiment is a draft.
  const editableSoleFeature =
    soleFeature &&
    experiment.status === "draft" &&
    !experiment.nextScheduledStatusUpdate &&
    soleFeature.state !== "locked" &&
    soleFeature.state !== "archived" &&
    soleFeature.state !== "discarded"
      ? soleFeature
      : null;

  const targetFeature = managedFeature ?? editableSoleFeature;

  // Choosing Values opens straight into adoption until the flag exists.
  const hasNoImplementations =
    (linkedFeatures ?? []).length === 0 &&
    !experiment.hasVisualChangesets &&
    !experiment.hasURLRedirects;
  const canAdopt =
    !targetFeature &&
    getImplementationType(experiment) === "values" &&
    hasNoImplementations &&
    experiment.status === "draft" &&
    !experiment.archived &&
    !experiment.nextScheduledStatusUpdate &&
    permissionsUtil.canViewFeatureModal(experiment.project);

  if (!targetFeature && !canAdopt) {
    return (
      <EditTrafficModal
        close={close}
        experiment={experiment}
        linkedFeatures={linkedFeatures}
        mutate={mutate}
        safeToEdit={safeToEdit}
        focusVariationId={focusVariationId}
        addVariationOnOpen={addVariationOnOpen}
      />
    );
  }

  return (
    <ManagedTrafficForm
      close={close}
      experiment={experiment}
      mutate={mutate}
      canAdopt={canAdopt}
      safeToEdit={safeToEdit}
      focusVariationId={focusVariationId}
      addVariationOnOpen={addVariationOnOpen}
    />
  );
}

function ManagedTrafficForm({
  close,
  experiment,
  mutate,
  canAdopt,
  safeToEdit,
  focusVariationId,
  addVariationOnOpen,
}: {
  close: () => void;
  experiment: ExperimentInterfaceStringDates;
  mutate: () => void;
  // The experiment may take on a managed flag from this modal.
  canAdopt: boolean;
  // False once running against a live rule: only names and descriptions change.
  safeToEdit: boolean;
  focusVariationId?: string | null;
  addVariationOnOpen?: boolean;
}) {
  const { apiCall } = useAuth();
  const { hasCommercialFeature } = useUser();
  const isBandit = experiment.type === "multi-armed-bandit";

  // Values are edited in the rows under the variations; here only while
  // adopting, when there is no flag and so no row yet.
  const [valueType, setValueType] = useState<FeatureValueType>("string");
  const [featureValues, setFeatureValues] = useState<Record<string, string>>(
    {},
  );

  const [adopting, setAdopting] = useState(false);
  const [renameTo, setRenameTo] = useState<string | null>(null);
  const [manualKey, setManualKey] = useState<string | null>(null);
  const { data: keyPlanData } = useApi<{
    blocker: string | null;
    keyPlan: ManagedFlagKeyPlan;
  }>(`/experiment/${experiment.id}/managed-flag/key-plan`, {
    shouldRun: () => canAdopt,
  });
  const keyPlan = keyPlanData?.keyPlan;
  const keyBlocker = keyPlanData?.blocker ?? null;
  const keyUnresolved =
    !!keyPlan &&
    !keyPlan.derivedIdAvailable &&
    !renameTo &&
    (manualKey === null || manualKey.trim() === "");

  const startAdopting = () => {
    setFeatureValues((current) => {
      const next = { ...current };
      (form.watch("variations") ?? []).forEach((v, i) => {
        if (!next[v.id]) next[v.id] = v.key || String(i);
      });
      return next;
    });
    setAdopting(true);
  };

  const settings = useOrgSettings();
  const gatedEnvSet: Set<string> | "all" | "none" = useMemo(() => {
    const raw = settings?.requireReviews;
    if (raw === true) return "all";
    if (!Array.isArray(raw)) return "none";
    // Adoption's flag lands in the experiment's project.
    const reviewSetting = getReviewSetting(raw, {
      project: experiment.project,
    });
    if (!reviewSetting?.requireReviewOn) return "none";
    const envList = reviewSetting.environments ?? [];
    return envList.length === 0 ? "all" : new Set(envList);
  }, [settings?.requireReviews, experiment.project]);

  // Re-express what is already there rather than clearing it.
  const handleValueTypeChange = (next: FeatureValueType) => {
    if (next === valueType) return;
    setFeatureValues((current) =>
      Object.fromEntries(
        Object.entries(current).map(([id, v], i) => [
          id,
          castFeatureValue({ value: v, from: valueType, to: next, index: i }),
        ]),
      ),
    );
    setValueType(next);
  };

  const latestPhase: ExperimentPhaseStringDates | undefined =
    experiment.phases[experiment.phases.length - 1];

  const form = useForm<
    ExperimentInterfaceStringDates & {
      variationWeights: number[];
      coverage: number;
    }
  >({
    defaultValues: {
      variations: getLatestPhaseVariations(experiment).map((v) => ({
        id: v.id,
        key: v.key,
        name: v.name,
        description: v.description,
        screenshots: v.screenshots,
      })),
      variationWeights:
        latestPhase?.variationWeights ??
        getEqualWeights(experiment.variations.length, 4),
      coverage: latestPhase?.coverage ?? 1,
    },
  });

  const coreOf = (v: {
    variations?: {
      id: string;
      key?: string;
      name?: string;
      description?: string;
    }[];
    variationWeights?: number[];
    coverage?: number;
  }) => ({
    variations: (v.variations ?? []).map((x) => ({
      id: x.id,
      key: x.key,
      name: x.name,
      description: x.description,
    })),
    weights: v.variationWeights,
    coverage: v.coverage,
  });

  const didAutoAdopt = useRef(false);
  useEffect(() => {
    if (didAutoAdopt.current || !canAdopt || adopting) return;
    didAutoAdopt.current = true;
    startAdopting();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canAdopt]);

  const openedWith = useRef<string | null>(null);
  if (openedWith.current === null) {
    openedWith.current = JSON.stringify(coreOf(form.getValues()));
  }

  const experimentDirty =
    JSON.stringify(
      coreOf({
        variations: form.watch("variations"),
        variationWeights: form.watch("variationWeights"),
        coverage: form.watch("coverage"),
      }),
    ) !== openedWith.current;

  const approvalRequired =
    gatedEnvSet !== "none" && hasCommercialFeature("require-approvals");

  // Only adopting creates a flag, so only it can need approval.
  const cta =
    !adopting || !approvalRequired
      ? "Save"
      : experimentDirty
        ? "Save & Request Approval"
        : "Request Approval";

  const sharedVariationProps = {
    label: null,
    valueAsId: isBandit,
    lockStructure: !safeToEdit,
    // Coverage belongs to the setup tab's Traffic card, which edits it in
    // place; this modal only moves traffic between variations.
    hideCoverage: true,
    hideSplits: isBandit || !safeToEdit,
    setWeight: (i: number, weight: number) =>
      form.setValue(`variationWeights.${i}`, weight),
    variations:
      form.watch("variations")?.map((v, i) => ({
        value: v.key || "",
        name: v.name,
        description: v.description,
        screenshots: v.screenshots,
        weight: form.watch(`variationWeights.${i}`),
        id: v.id,
        featureValue: featureValues[v.id] ?? "",
      })) ?? [],
    setVariations: (v: ManagedSortableVariation[]) => {
      setFeatureValues(
        Object.fromEntries(v.map((row) => [row.id, row.featureValue ?? ""])),
      );
      form.setValue(
        "variations",
        v.map((data) => {
          const { value, ...newData } = data;
          return {
            name: "",
            description: "",
            screenshots: [],
            ...newData,
            key: value,
          };
        }),
      );
      form.setValue(
        "variationWeights",
        v.map((row) => row.weight),
      );
    },
    showPreview: true,
    autoFocusVariationId: focusVariationId,
    autoAddVariationOnMount: addVariationOnOpen,
  };

  const submit = form.handleSubmit(async (value) => {
    const originalVariationCount = getLatestPhaseVariations(experiment).length;
    const data = { ...value };
    data.variations = [...value.variations].map((variation, i) => {
      if (!variation.key) variation.key = i + "";
      return variation;
    });

    // fix some common bugs
    if (!isBandit) {
      const newWeights = [
        ...data.variations.map((_, i) =>
          Math.min(
            Math.max(
              data.variationWeights?.[i] ?? 1 / (data.variations?.length || 2),
              0,
            ),
            1,
          ),
        ),
      ];
      data.variationWeights = distributeWeights(newWeights, true);
    } else {
      const latestVariationWeights = latestPhase?.variationWeights ?? [];
      if (
        data.variations.length !== data.variationWeights.length ||
        data.variations.length !== latestVariationWeights.length
      ) {
        // only recompute weights if original weights are the wrong size
        data.variationWeights = getEqualWeights(data.variations.length || 2, 4);
      } else {
        data.variationWeights = [...latestVariationWeights];
      }
    }

    // A new row has no value yet, so derive one from the key.
    const valueFor = (v: { id: string; key?: string }, i: number) => {
      const typed = featureValues[v.id];
      if (
        typed !== undefined &&
        (typed.trim() !== "" || valueType === "string")
      )
        return typed;
      return castFeatureValue({
        value: v.key || String(i),
        from: "string",
        to: valueType,
        index: i,
      });
    };
    // Validated before either request is sent.
    const flagValues = adopting
      ? data.variations.map((v, i) => ({
          variationId: v.id,
          value: validateFeatureValue(
            { valueType },
            valueFor(v, i),
            `Variation ${i}`,
          ),
        }))
      : null;

    // Once started only names and descriptions leave here.
    const lockedVariations = experiment.variations.map((live) => {
      const edited = data.variations.find((v) => v.id === live.id);
      return edited
        ? { ...live, name: edited.name, description: edited.description }
        : live;
    });
    // Later calls can fail after earlier ones landed; refetch regardless.
    try {
      if (safeToEdit) {
        await apiCall(`/experiment/${experiment.id}`, {
          method: "POST",
          body: JSON.stringify(data),
        });
      } else if (experimentDirty) {
        await apiCall(`/experiment/${experiment.id}`, {
          method: "POST",
          body: JSON.stringify({ variations: lockedVariations }),
        });
      }

      if (adopting) {
        await apiCall(`/experiment/${experiment.id}/managed-flag`, {
          method: "POST",
          body: JSON.stringify({
            valueType,
            variations: flagValues,
            ...(manualKey ? { featureId: manualKey } : {}),
            ...(renameTo && !manualKey ? { trackingKey: renameTo } : {}),
          }),
        });
      }
    } catch (e) {
      mutate();
      throw e;
    }
    mutate();
    track("edited-traffic");

    const numVariationsAdded = data.variations.length - originalVariationCount;
    if (numVariationsAdded > 0) {
      track("Added Variations", {
        source: "edit-traffic-modal",
        numVariationsAdded,
        totalVariations: data.variations.length,
      });
    }
  });

  return (
    <ModalStandard
      onOpenAutoFocus={(e) => {
        // Radix focuses the first tabbable node, which would open the coverage tooltip.
        const content = e.currentTarget as HTMLElement;
        e.preventDefault();
        if (!content.contains(document.activeElement)) content.focus();
      }}
      trackingEventModalType="edit-traffic-modal"
      open={true}
      close={close}
      header="Edit Variations"
      submit={submit}
      cta={cta}
      ctaEnabled={
        !adopting ||
        (!keyBlocker &&
          !keyUnresolved &&
          (!keyPlan?.regexError || !!manualKey?.trim()))
      }
      size="lg"
    >
      <Box pt="2">
        <ExperimentManagedFeatureVariationEditor
          {...sharedVariationProps}
          belowCoverage={
            canAdopt ? (
              <Box mb="3">
                <Box mb="3" width="200px">
                  <ValueTypeField
                    size="md"
                    value={valueType}
                    order={EXPERIMENT_VALUE_TYPE_ORDER}
                    disabledOptions={blockedExperimentValueTypes(
                      form.watch("variations")?.length ?? 0,
                    )}
                    onChange={(v) => {
                      if (v !== "config") handleValueTypeChange(v);
                    }}
                  />
                </Box>
                {keyBlocker ? (
                  <Callout status="warning">{keyBlocker}</Callout>
                ) : keyPlan ? (
                  <Box>
                    {keyPlan.derivedIdAvailable ? (
                      // Only when it differs from the Experiment Key above.
                      keyPlan.sanitized ? (
                        <Metadata
                          label="Feature Flag key"
                          value={
                            <Text weight="semibold">{keyPlan.derivedId}</Text>
                          }
                        />
                      ) : null
                    ) : (
                      <Callout status="warning">
                        <Box>
                          A Feature Flag named{" "}
                          <strong>{keyPlan.derivedId}</strong> already exists,
                          so it can&apos;t match this experiment&apos;s key.
                        </Box>
                        <Flex align="center" gap="3" mt="2" wrap="wrap">
                          {keyPlan.suggestedPair && (
                            <Button
                              variant={renameTo ? "solid" : "outline"}
                              size="sm"
                              onClick={() => {
                                setManualKey(null);
                                setRenameTo(
                                  keyPlan.suggestedPair?.trackingKey ?? null,
                                );
                              }}
                            >
                              Use {keyPlan.suggestedPair.trackingKey} for both
                            </Button>
                          )}
                          {manualKey === null && (
                            <Link
                              onClick={() => {
                                setRenameTo(null);
                                setManualKey("");
                              }}
                              size="sm"
                              weight="bold"
                            >
                              Choose a Feature Flag key instead
                            </Link>
                          )}
                        </Flex>
                        {renameTo && (
                          <Box mt="2">
                            <Text size="sm" color="text-low">
                              The Experiment Key becomes{" "}
                              <strong>{renameTo}</strong> and the Feature Flag
                              is created with the same key.
                            </Text>
                          </Box>
                        )}
                      </Callout>
                    )}
                    {manualKey !== null && (
                      <Box mt="3">
                        <Field
                          size="md"
                          label="Feature Flag key"
                          value={manualKey}
                          onChange={(e) => setManualKey(e.target.value)}
                          pattern="^[a-zA-Z0-9_.:|\-]+$"
                          title="Only letters, numbers, and the characters '_-.:|' allowed. No spaces."
                          required
                          helpText="Won't match the Experiment Key. Cannot be changed later."
                        />
                      </Box>
                    )}
                    {keyPlan.regexError && (
                      <Callout status="error" mt="3">
                        <Box>{keyPlan.regexError}</Box>
                        {manualKey === null && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setRenameTo(null);
                              setManualKey("");
                            }}
                          >
                            Choose a Feature Flag key instead
                          </Button>
                        )}
                      </Callout>
                    )}
                    {keyPlan.derivedIdAvailable && keyPlan.sanitized && (
                      <Box mt="1">
                        <Text size="sm" color="text-low">
                          Adapted from the Experiment Key, which contains
                          characters a Feature Flag key can&apos;t use.
                        </Text>
                      </Box>
                    )}
                  </Box>
                ) : null}
              </Box>
            ) : null
          }
          hideFeatureValue={!adopting}
          valueTooltip={null}
          valueType={valueType}
          // No flag yet; scope constants to the experiment's project.
          constantContext={{ project: experiment.project || undefined }}
        />
      </Box>
    </ModalStandard>
  );
}
