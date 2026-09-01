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
  getReviewSetting,
  isManagedByExperiment,
  naiveFlattenV1Rules,
  parsePlainJSONObject,
  stripDefaultsForSparse,
  validateFeatureValue,
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

type KeyPlan = {
  derivedId: string;
  derivedIdAvailable: boolean;
  sanitized: boolean;
  suggestedPair: { trackingKey: string; featureId: string } | null;
  regexError: string | null;
};

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
  // Open straight into adoption, from the overview's "add variation values".
  adoptOnOpen?: boolean;
}

// Edit Traffic & Variations when the only implementation is a Feature Flag.
// A fork of `EditTrafficModal`; anything else is delegated straight back.
export default function ExperimentManagedTrafficModal({
  close,
  experiment,
  linkedFeatures,
  mutate,
  safeToEdit,
  focusVariationId,
  addVariationOnOpen,
  adoptOnOpen,
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

  // The server only accepts value edits for an unmanaged flag while the
  // experiment is a draft; a managed one it accepts at any time.
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

  // Nothing wired up yet: this modal is the only route to adopting one.
  const hasNoImplementations =
    (linkedFeatures ?? []).length === 0 &&
    !experiment.hasVisualChangesets &&
    !experiment.hasURLRedirects;
  const canAdopt =
    !targetFeature &&
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
      adoptOnOpen={adoptOnOpen}
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
  adoptOnOpen,
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
  adoptOnOpen?: boolean;
}) {
  const { apiCall } = useAuth();
  const permissionsUtil = usePermissionsUtil();
  const isBandit = experiment.type === "multi-armed-bandit";
  const feature = targetFeature?.feature ?? null;

  // Including the value a newly added variation needs.
  const canEditValues =
    !!feature && permissionsUtil.canEditFeatureDrafts(feature);

  // The draft's staged type, not the live one: a draft that re-typed the flag
  // has not published yet, so `feature.valueType` still reads as the old type
  // and the editor would reopen in the wrong mode over the new values.
  const seedValueType =
    targetFeature?.pendingDraft?.valueType ?? feature?.valueType ?? "string";
  const [valueType, setValueType] = useState<FeatureValueType>(seedValueType);
  // Formatted at seed time, not on save: a value stored compact opens in the
  // multiline editor already expanded, and the dirty baseline is captured from
  // this same state, so formatting alone never reads as an edit.
  // Sparse patch mode for this feature's experiment-ref rule, mirroring the
  // linked-feature editor: eligible only while the flag stays JSON with a plain
  // object default, and forced on for a config-backed flag, whose arm values
  // always merge onto the resolved config.
  const isConfigBacked = !!feature && getFeatureBaseConfigKey(feature) !== null;
  const [sparse, setSparse] = useState(
    (targetFeature?.pendingDraft?.sparse ?? !!targetFeature?.sparse) ||
      (!!feature && isConfigBacked),
  );

  const [featureValues, setFeatureValues] = useState<Record<string, string>>(
    () =>
      Object.fromEntries(
        (targetFeature?.values ?? []).map((v) => [
          v.variationId,
          seedValueType === "json" ? (formatJSON(v.value) ?? v.value) : v.value,
        ]),
      ),
  );

  // Adoption: the experiment takes on a managed flag when this modal saves.
  const [adopting, setAdopting] = useState(false);
  const [renameTo, setRenameTo] = useState<string | null>(null);
  const [manualKey, setManualKey] = useState<string | null>(null);
  const { data: keyPlanData } = useApi<{
    blocker: string | null;
    keyPlan: KeyPlan;
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

  // A flag the experiment doesn't own stays read-only until asked, so changing
  // traffic alone never opens a draft on someone else's flag.
  const [editingValues, setEditingValues] = useState(isManaged);
  const valuesShown = !!feature || adopting;

  // Seeded from the variation keys, so what is shown is what gets saved.
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

  // Mirrors the back end: a draft is selectable only if it already carries this
  // experiment's rule, otherwise the submit fails opaquely.
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
    // Adoption has no Feature Flag yet, but the one it creates lands in the
    // experiment's project, so the rules resolve against that instead.
    const reviewSetting = getReviewSetting(
      raw,
      feature ?? { project: experiment.project },
    );
    if (!reviewSetting?.requireReviewOn) return "none";
    const envList = reviewSetting.environments ?? [];
    return envList.length === 0 ? "all" : new Set(envList);
  }, [settings?.requireReviews, feature, experiment.project]);

  // `draftRevisionVersion` is only set while the experiment is a draft, so a
  // running managed experiment falls back to its pending draft.
  const targetDraftVersion =
    targetFeature?.draftRevisionVersion ??
    (isManaged ? (targetFeature?.pendingDraft?.version ?? null) : null);
  const initialMode: DraftMode =
    targetDraftVersion != null ? "existing" : "new";

  const [mode, setMode] = useState<DraftMode>(initialMode);
  const [selectedDraft, setSelectedDraft] = useState<number | null>(
    targetDraftVersion,
  );

  // On first render the revisions haven't loaded, so the dropdown can't label
  // them. Re-apply the defaults once they arrive.
  const initializedFromData = useRef(false);
  useEffect(() => {
    if (initializedFromData.current || !revisionData) return;
    initializedFromData.current = true;
    setMode(initialMode);
    setSelectedDraft(targetDraftVersion);
  }, [revisionData, initialMode, targetDraftVersion]);

  // The linking flow adds the experiment-ref rule in a draft, so live doesn't
  // have it yet: only that draft can take the change.
  const ruleOnlyOnDraft =
    targetFeature?.state === "draft" &&
    targetFeature.liveHasMatchingRule === false &&
    targetFeature.draftRevisionVersion != null;

  const typeChanged = !!feature && valueType !== feature.valueType;
  // Judged against what the draft leaves behind, not what is live: a draft that
  // re-typed the flag to JSON has a JSON default staged, while the live feature
  // still reads as the old type and would rule sparse out.
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

  // Structural so the shared editor's row type still satisfies it.
  const featureValueOf = (row: { id: string; featureValue?: string }) =>
    row.featureValue ?? "";

  // Compared against what the modal opened with, not form dirtiness: the rows
  // write values and experiment changes through one setter.
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
    if (didAutoAdopt.current || !adoptOnOpen || !canAdopt || adopting) return;
    didAutoAdopt.current = true;
    startAdopting();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adoptOnOpen, canAdopt]);

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
  // With no flag the rows still rebuild `featureValues`, which would read as an edit.
  const valuesDirty =
    adopting ||
    (!!feature &&
      JSON.stringify({ valueType, sparse, featureValues }) !==
        openedWith.current.values);

  // `gatedEnvSet` resolves the review rules for the project this flag is (or
  // will be) in, so adoption and editing ask the same question.
  const approvalRequired = gatedEnvSet !== "none";

  const cta =
    !valuesDirty || !approvalRequired
      ? "Save"
      : experimentDirty
        ? "Save & Request Approval"
        : "Request Approval";

  // What a patch is measured against. A managed flag's default IS its control
  // value (the server stores values[0] as the default), so while editing — or
  // while creating the flag — the control in the form is truer than anything
  // already saved.
  const controlVariationId = form.watch("variations")?.[0]?.id;
  const sparseBase =
    ((isManaged || adopting) && controlVariationId
      ? featureValues[controlVariationId]
      : undefined) ??
    draftDefaultValue ??
    "";

  const sparseEligible =
    valueType === "json" &&
    // A flag being created has no live type to consult, and its default will be
    // whatever the control ends up holding.
    (adopting || seedValueType === "json") &&
    parsePlainJSONObject(sparseBase) !== null;

  // Toggling rewrites every value so the editor is never left with a
  // default-laden patch (on) or a bare patch shown as a whole value (off) —
  // the same conversion the Feature Flag rule editors run.
  const sparseToggle =
    // No feature exists yet while adopting, so `canEditValues` is false there
    // even though authoring the flag is exactly what is happening.
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
                  // A managed flag's control IS the default the others patch
                  // onto, so it always states the whole value. Stripping it
                  // against itself would leave {} and take the default with it.
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
    // Coverage only reaches the server on the safeToEdit branch of `submit`.
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

    // Experiment state first, then values; the second call re-sends the
    // variations so the server checks each has one. A locked structure still
    // carries names and descriptions — only traffic and ids are read-only
    // there — so send the variations alone rather than the whole shape.
    if (safeToEdit) {
      await apiCall(`/experiment/${experiment.id}`, {
        method: "POST",
        body: JSON.stringify(data),
      });
    } else if (experimentDirty) {
      await apiCall(`/experiment/${experiment.id}`, {
        method: "POST",
        body: JSON.stringify({ variations: data.variations }),
      });
    }

    if (adopting) {
      // Same endpoint and server-side gates as the old add-flag modal.
      await apiCall(`/experiment/${experiment.id}/managed-flag`, {
        method: "POST",
        body: JSON.stringify({
          valueType,
          variations: data.variations.map((v, i) => ({
            variationId: v.id,
            value:
              featureValues[v.id] ??
              castFeatureValue({
                value: v.key || String(i),
                from: "string",
                to: valueType,
                index: i,
              }),
          })),
          ...(sparse ? { sparse: true } : {}),
          ...(manualKey ? { featureId: manualKey } : {}),
          ...(renameTo && !manualKey ? { trackingKey: renameTo } : {}),
        }),
      });
    }

    if (feature && canEditValues && editingValues) {
      const values = data.variations.map((v, i) => ({
        variationId: v.id,
        value: validateFeatureValue(
          {
            valueType,
            // A schema describes the type it was written for.
            jsonSchema: typeChanged ? undefined : feature.jsonSchema,
          },
          featureValues[v.id] ??
            castFeatureValue({
              value: v.key || String(i),
              from: "string",
              to: valueType,
              index: i,
            }),
          `Variation ${i}`,
        ),
      }));

      await apiCall(`/experiment/${experiment.id}/features`, {
        method: "POST",
        body: JSON.stringify({
          variations: data.variations,
          variationWeights: data.variationWeights,
          features: {
            [feature.id]: {
              variations: values,
              ...(sparseEligible && { sparse }),
              ...(typeChanged && { valueType }),
              revisionOptions:
                mode === "existing" && selectedDraft != null
                  ? { targetVersion: selectedDraft }
                  : { forceNewDraft: true },
            },
          },
        }),
      });
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
        // Radix walks to the first tabbable node on open, which here is the
        // coverage tooltip's trigger — and a Radix tooltip opens on focus. A
        // field carrying `autoFocus` has already claimed focus by now; if none
        // did, park it on the dialog itself.
        const content = e.currentTarget as HTMLElement;
        e.preventDefault();
        if (!content.contains(document.activeElement)) content.focus();
      }}
      trackingEventModalType="edit-traffic-modal"
      open={true}
      close={close}
      header="Edit Traffic & Variations"
      headerAction={
        // One draft matters at a time for a managed flag, and the defaults
        // already resolve to it.
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
        !adopting || (!keyBlocker && !keyUnresolved && !keyPlan?.regexError)
      }
      size="lg"
    >
      <Box pt="2">
        {/* The managed editor also drives the adoption case, where it owns the
            opt-in button and the value column it reveals. */}
        {feature || canAdopt ? (
          <ExperimentManagedFeatureVariationEditor
            {...sharedVariationProps}
            coverageTooltip={coverageTooltip}
            belowCoverage={
              canAdopt && !adopting ? null : canAdopt && adopting ? (
                <Box mb="3">
                  <Box mb="3" width="200px">
                    <ValueTypeField
                      size="md"
                      value={valueType}
                      order={VALUE_TYPE_ORDER}
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
                        // Only worth stating when it differs from the
                        // Experiment Key shown above; otherwise it repeats it.
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
                          {keyPlan.regexError}
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
                      // The row owns the spacing; the field's own form-group
                      // margin would drop the switch beside it.
                      containerClassName="mb-0"
                      value={valueType}
                      order={VALUE_TYPE_ORDER}
                      onChange={(v) => {
                        if (v !== "config" && canEditValues)
                          handleValueTypeChange(v);
                      }}
                    />
                  </Box>
                  {sparseToggle}
                </Flex>
              ) : (
                // A flag the experiment doesn't own: name it, since the values
                // below belong to it rather than to this experiment.
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
            onAddValues={canAdopt && !adopting ? startAdopting : undefined}
            valueDisabled={!editingValues && !adopting}
            valueTooltip={
              // A managed flag publishes from this experiment, so its staging
              // needs no explaining; a shared flag's does.
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
            // Carries the base a patch is measured against, so the sparse
            // Preview tab expands onto the same value the toggle stripped.
            feature={
              feature
                ? { ...feature, valueType, defaultValue: sparseBase }
                : undefined
            }
            // While adopting there is no Feature Flag yet, so scope the
            // constant picker to the project the flag will be created in.
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
