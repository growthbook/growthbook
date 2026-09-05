import { useForm } from "react-hook-form";
import {
  ExperimentInterfaceStringDates,
  ExperimentPhaseStringDates,
  LinkedFeatureInfo,
} from "shared/types/experiment";
import { getEqualWeights, getLatestPhaseVariations } from "shared/experiments";
import { ExperimentRefRule, FeatureValueType } from "shared/types/feature";
import {
  FeatureRevisionInterface,
  MinimalFeatureRevisionInterface,
} from "shared/types/feature-revision";
import {
  castFeatureValue,
  expandSparseToFull,
  getFeatureBaseConfigKey,
  getImplementationType,
  getReviewSetting,
  isManagedByExperiment,
  naiveFlattenV1Rules,
  parsePlainJSONObject,
  stripDefaultsForSparse,
  validateFeatureValue,
  type ManagedFlagKeyPlan,
} from "shared/util";
import { Box, Flex } from "@radix-ui/themes";
import { useEffect, useMemo, useRef, useState } from "react";
import FeatureVariationsInput from "@/components/Features/FeatureVariationsInput";
import ValueTypeField from "@/components/Features/FeatureModal/ValueTypeField";
import SparsePatchToggle from "@/components/Features/SparsePatchToggle";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import useApi from "@/hooks/useApi";
import useOrgSettings from "@/hooks/useOrgSettings";
import LinkedFeatureLabel from "@/components/Experiment/LinkedFeatureLabel";
import DraftSelectorDropdown, {
  DraftMode,
} from "@/components/Features/DraftSelectorDropdown";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import { distributeWeights } from "@/services/utils";
import { formatJSON } from "@/services/features";
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

type FeatureRevisionResponse = {
  revisionList: MinimalFeatureRevisionInterface[];
  revisions: FeatureRevisionInterface[];
};

// Boolean is a poor fit for most experiments, so it sits last.
const VALUE_TYPE_ORDER: FeatureValueType[] = [
  "string",
  "json",
  "number",
  "boolean",
];

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

  // Unmanaged flag values are editable only while the experiment is a draft.
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
      targetFeature={targetFeature}
      isManaged={!!managedFeature}
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
  targetFeature,
  isManaged,
  canAdopt,
  safeToEdit,
  focusVariationId,
  addVariationOnOpen,
}: {
  close: () => void;
  experiment: ExperimentInterfaceStringDates;
  mutate: () => void;
  // null while the experiment has no implementation and `canAdopt` is set.
  targetFeature: LinkedFeatureInfo | null;
  // The experiment may take on a managed flag from this modal.
  canAdopt: boolean;
  // Managed here: it may be re-typed, and its rule is the flag's only one.
  isManaged: boolean;
  // False once running against a live rule: values stay editable, structure not.
  safeToEdit: boolean;
  focusVariationId?: string | null;
  addVariationOnOpen?: boolean;
}) {
  const { apiCall } = useAuth();
  const { hasCommercialFeature } = useUser();
  const permissionsUtil = usePermissionsUtil();
  const isBandit = experiment.type === "multi-armed-bandit";
  const feature = targetFeature?.feature ?? null;

  const canEditValues =
    !!feature && permissionsUtil.canEditFeatureDrafts(feature);

  // The draft's staged type, not live.
  const seedValueType =
    targetFeature?.pendingDraft?.valueType ?? feature?.valueType ?? "string";
  const [valueType, setValueType] = useState<FeatureValueType>(seedValueType);
  // Formatted at seed time so the dirty baseline matches.
  const isConfigBacked = !!feature && getFeatureBaseConfigKey(feature) !== null;
  const [sparse, setSparse] = useState(
    (targetFeature?.pendingDraft?.sparse ?? !!targetFeature?.sparse) ||
      (!!feature && isConfigBacked),
  );

  const [featureValues, setFeatureValues] = useState<Record<string, string>>(
    () =>
      Object.fromEntries(
        (
          targetFeature?.pendingDraft?.values ??
          targetFeature?.values ??
          []
        ).map((v) => [
          v.variationId,
          seedValueType === "json" ? (formatJSON(v.value) ?? v.value) : v.value,
        ]),
      ),
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

  // Someone else's flag stays read-only until asked.
  const [editingValues, setEditingValues] = useState(isManaged);
  const valuesShown = !!feature || adopting;

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
  const { data: revisionData } = useApi<FeatureRevisionResponse>(
    `/feature/${targetFeature?.feature.id}`,
    { shouldRun: () => !!targetFeature },
  );
  const revisionList = revisionData?.revisionList ?? [];

  // Mirrors the back end: a draft is selectable only if it carries this experiment's rule.
  const eligibleDraftVersions = useMemo(() => {
    const set = new Set<number>();
    for (const r of revisionData?.revisions ?? []) {
      const hasRefRule = naiveFlattenV1Rules(r.rules).some(
        (rule) =>
          rule.type === "experiment-ref" &&
          (rule as ExperimentRefRule).experimentId === experiment.id,
      );
      if (hasRefRule) set.add(r.version);
    }
    if (targetFeature?.draftRevisionVersion != null) {
      set.add(targetFeature.draftRevisionVersion);
    }
    if (targetFeature?.pendingDraft) {
      set.add(targetFeature.pendingDraft.version);
    }
    return set;
  }, [revisionData, experiment.id, targetFeature]);

  const gatedEnvSet: Set<string> | "all" | "none" = useMemo(() => {
    const raw = settings?.requireReviews;
    if (raw === true) return "all";
    if (!Array.isArray(raw)) return "none";
    // Adoption's flag lands in the experiment's project.
    const reviewSetting = getReviewSetting(
      raw,
      feature ?? { project: experiment.project },
    );
    if (!reviewSetting?.requireReviewOn) return "none";
    const envList = reviewSetting.environments ?? [];
    return envList.length === 0 ? "all" : new Set(envList);
  }, [settings?.requireReviews, feature, experiment.project]);

  // A running managed experiment falls back to its pending draft.
  const targetDraftVersion =
    targetFeature?.draftRevisionVersion ??
    (isManaged ? (targetFeature?.pendingDraft?.version ?? null) : null);
  const initialMode: DraftMode =
    targetDraftVersion != null ? "existing" : "new";

  const [mode, setMode] = useState<DraftMode>(initialMode);
  const [selectedDraft, setSelectedDraft] = useState<number | null>(
    targetDraftVersion,
  );

  // Re-apply defaults once revisions load.
  const initializedFromData = useRef(false);
  useEffect(() => {
    if (initializedFromData.current || !revisionData) return;
    initializedFromData.current = true;
    setMode(initialMode);
    setSelectedDraft(targetDraftVersion);
  }, [revisionData, initialMode, targetDraftVersion]);

  // Linking stages the rule in a draft; live doesn't have it yet.
  const ruleOnlyOnDraft =
    targetFeature?.state === "draft" &&
    targetFeature.liveHasMatchingRule === false &&
    targetFeature.draftRevisionVersion != null;

  const typeChanged = !!feature && valueType !== feature.valueType;
  // Undoing a staged re-type is also a move.
  const typeMoves = !!feature && (typeChanged || valueType !== seedValueType);
  const draftDefaultValue =
    targetFeature?.pendingDraft?.defaultValue ?? feature?.defaultValue;
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

  const featureValueOf = (row: { id: string; featureValue?: string }) =>
    row.featureValue ?? "";

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

  const openedWith = useRef<{ core: string; values: string } | null>(null);
  if (openedWith.current === null) {
    openedWith.current = {
      core: JSON.stringify(coreOf(form.getValues())),
      values: JSON.stringify({ valueType, sparse, featureValues }),
    };
  }

  const experimentDirty =
    JSON.stringify(
      coreOf({
        variations: form.watch("variations"),
        variationWeights: form.watch("variationWeights"),
        coverage: form.watch("coverage"),
      }),
    ) !== openedWith.current.core;
  // Two values only: a third boolean variation would duplicate one of them.
  const booleanBlocked =
    (form.watch("variations")?.length ?? 0) > 2
      ? { boolean: "needs exactly two variations" }
      : undefined;
  const valuesDirty =
    adopting ||
    (!!feature &&
      JSON.stringify({ valueType, sparse, featureValues }) !==
        openedWith.current.values);

  const approvalRequired =
    gatedEnvSet !== "none" && hasCommercialFeature("require-approvals");

  const cta =
    !valuesDirty || !approvalRequired
      ? "Save"
      : experimentDirty
        ? "Save & Request Approval"
        : "Request Approval";

  // A managed flag's default is values[0].
  const controlVariationId = form.watch("variations")?.[0]?.id;
  const sparseBase =
    ((isManaged || adopting) && controlVariationId
      ? featureValues[controlVariationId]
      : undefined) ??
    draftDefaultValue ??
    "";

  const sparseEligible =
    valueType === "json" &&
    (adopting || seedValueType === "json") &&
    parsePlainJSONObject(sparseBase) !== null;

  // Rewrites every value, like the rule editors.
  const sparseToggle =
    sparseEligible && !isConfigBacked && (canEditValues || adopting) ? (
      // 32px is the select's height, so the switch sits on its centre line.
      <Flex align="center" style={{ minHeight: 32 }}>
        <SparsePatchToggle
          checked={sparse}
          disabled={!editingValues && !adopting}
          onChange={(checked) => {
            const def = sparseBase;
            setFeatureValues((prev) =>
              Object.fromEntries(
                Object.entries(prev).map(([id, v]) => {
                  // Control is the default the others patch onto.
                  if (isManaged && id === controlVariationId) return [id, v];
                  return [
                    id,
                    checked
                      ? stripDefaultsForSparse(v, def)
                      : expandSparseToFull(v, def),
                  ];
                }),
              ),
            );
            setSparse(checked);
          }}
        />
      </Flex>
    ) : null;

  const coverageTooltip = isManaged
    ? null
    : "Users not included in this experiment will flow through to subsequent feature flag rules";

  const sharedVariationProps = {
    label: null,
    valueAsId: isBandit,
    lockStructure: !safeToEdit,
    hideCoverage: !safeToEdit,
    hideSplits: isBandit || !safeToEdit,
    coverage: form.watch("coverage"),
    setCoverage: (coverage: number) => form.setValue("coverage", coverage),
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
        Object.fromEntries(v.map((row) => [row.id, featureValueOf(row)])),
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

    // A new row has no value yet; a sparse patch may be empty, otherwise derive one from the key.
    const valueFor = (v: { id: string; key?: string }, i: number) => {
      const typed = featureValues[v.id];
      if (
        typed !== undefined &&
        (typed.trim() !== "" || valueType === "string")
      )
        return typed;
      if (sparse && valueType === "json") return "{}";
      return castFeatureValue({
        value: v.key || String(i),
        from: "string",
        to: valueType,
        index: i,
      });
    };
    // Validated before either request is sent.
    const flagValues =
      adopting || (feature && canEditValues && editingValues)
        ? data.variations.map((v, i) => ({
            variationId: v.id,
            value: validateFeatureValue(
              {
                valueType,
                jsonSchema:
                  !feature || typeChanged ? undefined : feature.jsonSchema,
              },
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
    const sentVariations = safeToEdit ? data.variations : lockedVariations;
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
            ...(sparse ? { sparse: true } : {}),
            ...(manualKey ? { featureId: manualKey } : {}),
            ...(renameTo && !manualKey ? { trackingKey: renameTo } : {}),
          }),
        });
      }

      if (feature && canEditValues && editingValues && flagValues) {
        await apiCall(`/experiment/${experiment.id}/features`, {
          method: "POST",
          body: JSON.stringify({
            variations: sentVariations,
            ...(safeToEdit && { variationWeights: data.variationWeights }),
            features: {
              [feature.id]: {
                variations: flagValues,
                ...(sparseEligible && { sparse }),
                ...(typeMoves && { valueType }),
                revisionOptions:
                  mode === "existing" && selectedDraft != null
                    ? { targetVersion: selectedDraft }
                    : { forceNewDraft: true },
              },
            },
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
      header={
        experiment.status === "draft"
          ? "Edit Traffic & Variations"
          : "Edit Variations"
      }
      headerAction={
        isManaged || !feature || !editingValues ? undefined : (
          <DraftSelectorDropdown
            feature={feature ?? undefined}
            revisionList={revisionList}
            mode={mode}
            setMode={setMode}
            selectedDraft={selectedDraft}
            setSelectedDraft={setSelectedDraft}
            canAutoPublish={false}
            gatedEnvSet={gatedEnvSet}
            locked={ruleOnlyOnDraft}
            lockedTooltip={
              ruleOnlyOnDraft
                ? "This experiment rule is added in this draft revision. Changes will be saved to it."
                : undefined
            }
            eligibleDraftVersions={eligibleDraftVersions}
          />
        )
      }
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
        {feature || canAdopt ? (
          <ExperimentManagedFeatureVariationEditor
            {...sharedVariationProps}
            coverageTooltip={coverageTooltip}
            belowCoverage={
              canAdopt ? (
                <Box mb="3">
                  <Box mb="3" width="200px">
                    <ValueTypeField
                      size="md"
                      value={valueType}
                      order={VALUE_TYPE_ORDER}
                      disabledOptions={booleanBlocked}
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
              ) : isManaged || !feature ? (
                <Flex mb="3" gap="5" align="end">
                  <Box width="200px">
                    <ValueTypeField
                      size="md"
                      containerClassName="mb-0"
                      value={valueType}
                      order={VALUE_TYPE_ORDER}
                      disabledOptions={booleanBlocked}
                      onChange={(v) => {
                        if (v !== "config" && canEditValues)
                          handleValueTypeChange(v);
                      }}
                    />
                  </Box>
                  {sparseToggle}
                </Flex>
              ) : (
                <Box mb="3">
                  <LinkedFeatureLabel featureId={feature.id} />
                  {sparseToggle && <Box mt="2">{sparseToggle}</Box>}
                </Box>
              )
            }
            valueLabel={
              isManaged || adopting ? undefined : "Feature Flag value"
            }
            hideFeatureValue={!valuesShown}
            valueDisabled={!editingValues && !adopting}
            valueTooltip={
              isManaged || adopting
                ? null
                : "Changes to feature values are saved to a draft revision. They are not published until the draft is."
            }
            onEditValues={
              !editingValues && canEditValues
                ? () => setEditingValues(true)
                : undefined
            }
            valueType={valueType}
            feature={
              feature
                ? { ...feature, valueType, defaultValue: sparseBase }
                : undefined
            }
            // No flag yet while adopting; scope to the experiment's project.
            constantContext={
              feature ? undefined : { project: experiment.project || undefined }
            }
            sparse={sparse}
            controlIsDefault={isManaged}
          />
        ) : (
          <FeatureVariationsInput {...sharedVariationProps} />
        )}
      </Box>
    </ModalStandard>
  );
}
