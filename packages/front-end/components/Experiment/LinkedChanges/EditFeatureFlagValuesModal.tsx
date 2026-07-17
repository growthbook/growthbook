import { useEffect, useMemo, useRef, useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { FeatureInterface } from "shared/types/feature";
import {
  FeatureRevisionInterface,
  MinimalFeatureRevisionInterface,
} from "shared/types/feature-revision";
import {
  ExperimentInterfaceStringDates,
  LinkedFeatureInfo,
} from "shared/types/experiment";
import {
  ExperimentRefRule,
  ExperimentRefVariation,
  Screenshot,
} from "shared/validators";
import { getEqualWeights, getLatestPhaseVariations } from "shared/experiments";
import {
  validateFeatureValue,
  getReviewSetting,
  generateVariationId,
  naiveFlattenV1Rules,
  parsePlainJSONObject,
  stripDefaultsForSparse,
  expandSparseToFull,
  getFeatureBaseConfigKey,
  getConfigSubtree,
  ensureConfigBacking,
} from "shared/util";
import { BsThreeDotsVertical } from "react-icons/bs";
import { Box, Flex, IconButton, Separator } from "@radix-ui/themes";
import { PiArrowsClockwise, PiPlusCircleFill } from "react-icons/pi";
import Tooltip from "@/components/Tooltip/Tooltip";
import { useAuth } from "@/services/auth";
import useApi from "@/hooks/useApi";
import useOrgSettings from "@/hooks/useOrgSettings";
import DraftSelectorDropdown, {
  DraftMode,
} from "@/components/Features/DraftSelectorDropdown";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import FeatureValueField from "@/components/Features/FeatureValueField";
import { useDefinitions } from "@/services/DefinitionsContext";
import LoadingOverlay from "@/components/LoadingOverlay";
import Text from "@/ui/Text";
import Field from "@/components/Forms/Field";
import Callout from "@/ui/Callout";
import {
  decimalToPercent,
  distributeWeights,
  percentToDecimal,
  rebalance,
} from "@/services/utils";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/ui/DropdownMenu";
import Link from "@/ui/Link";
import { getDefaultVariationValue } from "@/services/features";
import Button from "@/ui/Button";
import track from "@/services/track";
import SparsePatchToggle from "@/components/Features/SparsePatchToggle";

export interface Props {
  feature: FeatureInterface;
  experiment: ExperimentInterfaceStringDates;
  linkedFeatureInfo: LinkedFeatureInfo;
  numLinkedChanges: number;
  close: () => void;
  mutate: () => void;
}

type FeatureRevisionResponse = {
  revisionList: MinimalFeatureRevisionInterface[];
  revisions: FeatureRevisionInterface[];
};

type VariationRow = {
  id: string;
  name: string;
  description?: string;
  key: string;
  screenshots: Screenshot[];
  weight: number;
  value: string;
};

type FormValues = { variations: VariationRow[] };

function SplitField({
  index,
  weight,
  onCommit,
}: {
  index: number;
  weight: number;
  onCommit: (i: number, decimal: number) => void;
}) {
  const weightPct = decimalToPercent(weight);
  const [val, setVal] = useState<string>(
    isNaN(weightPct) ? "" : String(weightPct),
  );

  useEffect(() => {
    const next = isNaN(weightPct) ? "" : String(weightPct);
    setVal((prev) => {
      const prevDecimal = percentToDecimal(prev);
      if (prev === "" || isNaN(prevDecimal) || prevDecimal !== weight) {
        return next;
      }
      return prev;
    });
  }, [weightPct, weight]);

  return (
    <Field
      label="Split %"
      type="number"
      min={0}
      max={100}
      step="0.01"
      containerClassName="mb-0"
      append="%"
      value={val}
      onChange={(e) => {
        setVal(e.target.value);
      }}
      onBlur={() => {
        if (val === "") {
          onCommit(index, 0);
          return;
        }
        let decimal = percentToDecimal(val);
        if (isNaN(decimal)) decimal = 0;
        if (decimal < 0) decimal = 0;
        if (decimal > 1) decimal = 1;
        onCommit(index, decimal);
      }}
    />
  );
}

export default function EditFeatureFlagValuesModal({
  feature,
  experiment,
  linkedFeatureInfo,
  numLinkedChanges,
  close,
  mutate,
}: Props) {
  const { apiCall } = useAuth();
  const settings = useOrgSettings();
  const { data, error } = useApi<FeatureRevisionResponse>(
    `/feature/${feature.id}`,
  );
  const revisionList = data?.revisionList ?? [];

  // Mirror the back-end eligibility check in validateExperimentFeatureUpdates:
  // a draft is selectable only if it contains an experiment-ref rule for this
  // experiment. Otherwise submit fails with an opaque server-side error.
  // Defensively union in linkedFeatureInfo.draftRevisionVersion so the
  // default-selected draft is never hidden by a stale/empty revisions list.
  const eligibleDraftVersions = useMemo(() => {
    const set = new Set<number>();
    for (const r of data?.revisions ?? []) {
      const hasRefRule = naiveFlattenV1Rules(r.rules).some(
        (rule) =>
          rule.type === "experiment-ref" &&
          (rule as ExperimentRefRule).experimentId === experiment.id,
      );
      if (hasRefRule) set.add(r.version);
    }
    if (linkedFeatureInfo.draftRevisionVersion != null) {
      set.add(linkedFeatureInfo.draftRevisionVersion);
    }
    return set;
  }, [data?.revisions, experiment.id, linkedFeatureInfo.draftRevisionVersion]);

  const latestPhase = experiment.phases?.[experiment.phases.length - 1];

  const phaseVariations = useMemo(
    () => getLatestPhaseVariations(experiment),
    [experiment],
  );

  const initialVariations = useMemo<VariationRow[]>(
    () =>
      phaseVariations.map((v, i) => ({
        id: v.id,
        name: v.name,
        description: v.description,
        key: v.key,
        screenshots: v.screenshots,
        weight: latestPhase?.variationWeights?.[i] ?? 0,
        value:
          linkedFeatureInfo.values.find((x) => x.variationId === v.id)?.value ??
          "",
      })),
    [phaseVariations, latestPhase?.variationWeights, linkedFeatureInfo.values],
  );

  const form = useForm<FormValues>({
    defaultValues: { variations: initialVariations },
  });
  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "variations",
  });

  const existingVariationIds = useMemo(
    () => new Set(experiment.variations.map((v) => v.id)),
    [experiment.variations],
  );

  const gatedEnvSet: Set<string> | "all" | "none" = useMemo(() => {
    const raw = settings?.requireReviews;
    if (raw === true) return "all";
    if (!Array.isArray(raw)) return "none";
    const reviewSetting = getReviewSetting(raw, feature);
    if (!reviewSetting?.requireReviewOn) return "none";
    const envList = reviewSetting.environments ?? [];
    return envList.length === 0 ? "all" : new Set(envList);
  }, [settings?.requireReviews, feature]);

  // The linking flow always creates a pending draft that adds the
  // experiment-ref rule, so live doesn't have the rule yet. Saving to a new
  // draft or a different existing draft would fail because those revisions
  // don't contain the rule. Lock the dropdown to the one draft that does.
  const ruleOnlyOnDraft =
    linkedFeatureInfo.state === "draft" &&
    linkedFeatureInfo.liveHasMatchingRule === false &&
    linkedFeatureInfo.draftRevisionVersion != null;

  const initialMode: DraftMode =
    linkedFeatureInfo.draftRevisionVersion != null ? "existing" : "new";
  const initialSelectedDraft = linkedFeatureInfo.draftRevisionVersion ?? null;

  const [mode, setMode] = useState<DraftMode>(initialMode);
  const [selectedDraft, setSelectedDraft] = useState<number | null>(
    initialSelectedDraft,
  );
  const [isEditingVariations, setIsEditingVariations] = useState(false);

  // On first render `useApi` hasn't resolved yet, so `revisionList` is empty
  // and the dropdown can't render revision labels. Re-apply the
  // linkedFeatureInfo-derived initial mode/selectedDraft once feature data arrives so the
  // dropdown reflects the linkedFeatureInfo defaults.
  const hasInitializedFromData = useRef(false);
  useEffect(() => {
    if (hasInitializedFromData.current || !data) return;
    hasInitializedFromData.current = true;
    setMode(initialMode);
    setSelectedDraft(initialSelectedDraft);
  }, [data, initialMode, initialSelectedDraft]);

  const handleSetMode = (newMode: DraftMode) => {
    if (newMode !== mode) {
      track("Edit Feature Flag Values: Draft Mode Change", {
        fromMode: mode,
        toMode: newMode,
        valueType: feature.valueType,
        eligibleDraftCount: eligibleDraftVersions.size,
      });
    }
    setMode(newMode);
  };

  const handleSetSelectedDraft = (v: number | null) => {
    if (v !== selectedDraft) {
      track("Edit Feature Flag Values: Selected Draft Revision Change", {
        changedFromInitial: v !== initialSelectedDraft,
        valueType: feature.valueType,
        eligibleDraftCount: eligibleDraftVersions.size,
      });
    }
    setSelectedDraft(v);
  };

  // Sparse patch mode for this feature's experiment-ref rule. Eligible only for
  // JSON features whose default is a plain object. The toggle rewrites every
  // variation value (strip keys equal to the default ⇄ expand onto the default)
  // and the new flag is persisted alongside the values on save.
  const sparseEligible =
    feature.valueType === "json" &&
    parsePlainJSONObject(feature.defaultValue ?? "") !== null;
  // Config-backed JSON flags always merge object arm values onto the resolved
  // config, so they're inherently sparse patches that serve the default's
  // config: default the toggle on (even for rules created via the v2 REST API
  // that carry no `sparse` flag), drop the toggle, and render the arms with the
  // config-backing editor. Mirrors StandardRuleFields / ExperimentRefFields.
  const { configs } = useDefinitions();
  const defaultConfigKey = getFeatureBaseConfigKey(feature);
  const isConfigBacked = defaultConfigKey !== null;
  const configBackingOptionKeys = useMemo(
    () =>
      defaultConfigKey
        ? getConfigSubtree(defaultConfigKey, configs)
        : undefined,
    [defaultConfigKey, configs],
  );
  const [sparse, setSparse] = useState(
    !!linkedFeatureInfo.sparse || isConfigBacked,
  );

  useEffect(() => {
    if (!isConfigBacked || !defaultConfigKey) return;
    const vars = (form.getValues("variations") || []) as { value?: string }[];
    vars.forEach((v, i) => {
      const normalized = ensureConfigBacking(v.value ?? "", defaultConfigKey);
      if (normalized !== v.value) {
        form.setValue(`variations.${i}.value`, normalized);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConfigBacked, defaultConfigKey]);

  const watchedVariations = form.watch("variations");

  const weights = (watchedVariations ?? []).map((v) => Number(v?.weight) || 0);
  const isEqualWeights =
    weights.length === 0 ||
    weights.every((w) => Math.abs(w - weights[0]) < 0.0001);

  const setEqualWeights = () => {
    getEqualWeights(fields.length).forEach((w, i) => {
      form.setValue(`variations.${i}.weight`, w);
    });
  };

  const rebalanceWeights = (i: number, newDecimal: number) => {
    const currentWeights = (form.getValues("variations") ?? []).map(
      (v) => Number(v?.weight) || 0,
    );
    const next = rebalance(currentWeights, i, newDecimal);
    next.forEach((w, j) => {
      if (w !== currentWeights[j]) {
        form.setValue(`variations.${j}.weight`, w);
      }
    });
  };

  const handleRemoveVariation = (i: number) => {
    const currentRows = form.getValues("variations") ?? [];
    const currentWeights = currentRows.map((v) => Number(v?.weight) || 0);
    const wasEqualWeights =
      currentWeights.length > 0 &&
      currentWeights.every((w) => Math.abs(w - currentWeights[0]) < 0.0001);

    track("Edit Feature Flag Values: Remove Variation", {
      valueType: feature.valueType,
      variationCountBefore: fields.length,
    });

    remove(i);

    const remainingWeights = currentWeights.filter((_, j) => j !== i);
    const newWeights = wasEqualWeights
      ? getEqualWeights(remainingWeights.length)
      : distributeWeights(remainingWeights, true);

    newWeights.forEach((w, j) => {
      form.setValue(`variations.${j}.weight`, w);
    });
  };

  const handleAddVariation = () => {
    const currentRows = form.getValues("variations") ?? [];
    const currentWeights = currentRows.map((v) => Number(v?.weight) || 0);
    const wasEqualWeights =
      currentWeights.length > 0 &&
      currentWeights.every((w) => Math.abs(w - currentWeights[0]) < 0.0001);

    track("Edit Feature Flag Values: Add Variation", {
      valueType: feature.valueType,
      variationCountBefore: fields.length,
    });

    append({
      id: generateVariationId(),
      name: `Variation ${fields.length}`,
      description: "",
      key: "",
      screenshots: [],
      weight: 0,
      value: getDefaultVariationValue(feature.defaultValue ?? ""),
    });

    const newLength = currentWeights.length + 1;
    const newWeights = wasEqualWeights
      ? getEqualWeights(newLength)
      : distributeWeights([...currentWeights, 0], true);

    newWeights.forEach((w, j) => {
      form.setValue(`variations.${j}.weight`, w);
    });

    setIsEditingVariations(true);
  };

  return (
    <ModalStandard
      trackingEventModalType="edit-experiment-feature-values"
      header="Edit Feature Flag Values"
      subheader="Changes made here will be reflected on the linked Feature Flag rule."
      headerAction={
        <DraftSelectorDropdown
          feature={feature}
          revisionList={revisionList}
          mode={mode}
          setMode={handleSetMode}
          selectedDraft={selectedDraft}
          setSelectedDraft={handleSetSelectedDraft}
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
      }
      submit={form.handleSubmit(async (values) => {
        const rows = values.variations;

        const updatedRefVariations: ExperimentRefVariation[] = rows.map(
          (r) => ({
            variationId: r.id,
            value: validateFeatureValue(feature, r.value ?? "", ""),
          }),
        );

        const needsRefix = updatedRefVariations.some(
          (v, i) => v.value !== (rows[i].value ?? ""),
        );
        if (needsRefix) {
          updatedRefVariations.forEach((v, i) => {
            form.setValue(`variations.${i}.value`, v.value);
          });
          throw new Error(
            "We fixed some errors in the values. If they look correct, submit again.",
          );
        }

        const updatedVariationWeights = rows.map((r) => Number(r.weight) || 0);
        const weightSumCheck = updatedVariationWeights.reduce(
          (a, w) => a + w,
          0,
        );
        if (Math.abs(weightSumCheck - 1) > 1e-4) {
          throw new Error("Variation splits must sum to 100%.");
        }

        const updatedVariations = rows.map((r) => ({
          id: r.id,
          name: r.name,
          description: r.description,
          key: r.key,
          screenshots: r.screenshots,
        }));

        const revisionOptions =
          mode === "existing" && selectedDraft != null
            ? { targetVersion: selectedDraft }
            : { forceNewDraft: true };

        await apiCall<{ status: number }>(
          `/experiment/${experiment.id}/features`,
          {
            method: "POST",
            body: JSON.stringify({
              variations: updatedVariations,
              variationWeights: updatedVariationWeights,
              features: {
                [feature.id]: {
                  variations: updatedRefVariations,
                  ...(sparseEligible && { sparse }),
                  revisionOptions,
                },
              },
            }),
          },
        );

        track("Edit Feature Flag Values: Save", {
          draftMode: mode,
          valueType: feature.valueType,
          numVariations: rows.length,
          hasNewVariations: rows.some((r) => !existingVariationIds.has(r.id)),
          eligibleDraftCount: eligibleDraftVersions.size,
          dropdownLocked: ruleOnlyOnDraft,
        });

        await mutate();
      })}
      cta="Save to draft"
      close={close}
      open={true}
      size={"lg"}
    >
      {error ? (
        <Text color="text-high">
          Failed to load feature revisions: {error.message}
        </Text>
      ) : !data ? (
        <Box style={{ position: "relative", minHeight: 80 }}>
          <LoadingOverlay />
        </Box>
      ) : (
        <>
          <Flex direction="column" gap="3" pt="2">
            {!isConfigBacked && sparseEligible && (
              <Flex>
                <SparsePatchToggle
                  checked={sparse}
                  onChange={(checked) => {
                    // Rewrite every variation value so the editor isn't left
                    // with a default-laden patch (on) or a bare patch shown as
                    // the full value (off).
                    const def = feature.defaultValue ?? "";
                    (form.getValues("variations") || []).forEach((v, i) => {
                      form.setValue(
                        `variations.${i}.value`,
                        checked
                          ? stripDefaultsForSparse(v.value ?? "", def)
                          : expandSparseToFull(v.value ?? "", def),
                      );
                    });
                    setSparse(checked);
                  }}
                />
              </Flex>
            )}
            {isEditingVariations && !isEqualWeights && (
              <Flex justify="end">
                <Tooltip
                  body="Assign equal weights to all variations"
                  tipPosition="top"
                >
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={setEqualWeights}
                    icon={<PiArrowsClockwise size={12} />}
                  >
                    Set equal splits
                  </Button>
                </Tooltip>
              </Flex>
            )}
            {fields.map((field, i) => {
              const row = watchedVariations?.[i] ?? field;
              const rowWeight = Number(row?.weight) || 0;
              const isNewVariation = !existingVariationIds.has(row.id);

              if (isEditingVariations) {
                return (
                  <Box key={field.id}>
                    <Flex direction="row" gap="3" align="start">
                      <Box style={{ paddingTop: 28 }}>
                        <Box
                          className={`variation with-variation-label variation${i}`}
                        >
                          <span className="label">{i}</span>
                        </Box>
                      </Box>
                      <Flex
                        direction="column"
                        gap="3"
                        style={{ flex: 1, minWidth: 0 }}
                      >
                        <Flex direction="row" gap="3" align="end">
                          <Box style={{ flex: 1 }}>
                            <Field
                              label="Name"
                              containerClassName="mb-0"
                              {...form.register(`variations.${i}.name`)}
                            />
                          </Box>
                          <Box style={{ width: 140 }}>
                            <SplitField
                              index={i}
                              weight={rowWeight}
                              onCommit={rebalanceWeights}
                            />
                          </Box>
                        </Flex>
                        <Box>
                          <Text as="label" weight="semibold">
                            Value
                          </Text>
                          <FeatureValueField
                            id={`variation-${row.id}`}
                            value={row.value ?? ""}
                            setValue={(val) =>
                              form.setValue(`variations.${i}.value`, val)
                            }
                            valueType={feature.valueType}
                            feature={feature}
                            renderJSONInline={true}
                            useCodeInput={true}
                            showFullscreenButton={true}
                            sparse={sparse}
                            allowConfigBacking={isConfigBacked}
                            configBackingOptionKeys={configBackingOptionKeys}
                            configBackingShowPatch={isConfigBacked}
                            lockConfigBacking={isConfigBacked}
                          />
                          {isNewVariation && numLinkedChanges > 1 && (
                            <Callout status="warning" mt="2">
                              <Text weight="semibold">Don&apos;t forget!</Text>{" "}
                              Define values for this new variation in other
                              implementations too.
                            </Callout>
                          )}
                        </Box>
                      </Flex>
                      <Box style={{ paddingTop: 24 }}>
                        <DropdownMenu
                          trigger={
                            <IconButton
                              variant="ghost"
                              color="gray"
                              radius="full"
                              size="2"
                              highContrast
                              style={{ margin: 0 }}
                            >
                              <BsThreeDotsVertical size={18} />
                            </IconButton>
                          }
                          menuPlacement="end"
                          variant="soft"
                        >
                          <DropdownMenuItem
                            color="red"
                            disabled={!isNewVariation}
                            tooltip={
                              !isNewVariation
                                ? "Existing experiment variations cannot be deleted."
                                : undefined
                            }
                            onClick={() => {
                              if (!isNewVariation) return;
                              handleRemoveVariation(i);
                            }}
                          >
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenu>
                      </Box>
                    </Flex>
                    {i < fields.length - 1 && <Separator size="4" my="4" />}
                  </Box>
                );
              }

              return (
                <Box key={field.id}>
                  <Flex justify="between" width="100%" mb="3">
                    <Flex align="center" direction="row" gap="2">
                      <Flex align="center">
                        <Box
                          className={`variation with-variation-label variation${i}`}
                        >
                          <span className="label">{i}</span>
                        </Box>
                        <Text weight="semibold" size="large">
                          {row.name}
                        </Text>
                      </Flex>
                      <Box as="span">&middot;</Box>
                      <Text color="text-mid">
                        {decimalToPercent(rowWeight)}% Split
                      </Text>
                    </Flex>
                    <DropdownMenu
                      trigger={
                        <IconButton
                          variant="ghost"
                          color="gray"
                          radius="full"
                          size="2"
                          highContrast
                          style={{ margin: 0 }}
                        >
                          <BsThreeDotsVertical size={18} />
                        </IconButton>
                      }
                      menuPlacement="end"
                      variant="soft"
                    >
                      <DropdownMenuItem
                        onClick={() => {
                          track(
                            "Edit Feature Flag Values: Enter Edit Variation Mode",
                            {
                              valueType: feature.valueType,
                            },
                          );
                          setIsEditingVariations(true);
                        }}
                      >
                        Edit
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        color="red"
                        disabled={!isNewVariation}
                        tooltip={
                          !isNewVariation
                            ? "Existing experiment variations cannot be deleted."
                            : undefined
                        }
                        onClick={() => {
                          if (!isNewVariation) return;
                          handleRemoveVariation(i);
                        }}
                      >
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenu>
                  </Flex>
                  <FeatureValueField
                    id={`variation-${row.id}`}
                    value={row.value ?? ""}
                    setValue={(val) =>
                      form.setValue(`variations.${i}.value`, val)
                    }
                    valueType={feature.valueType}
                    feature={feature}
                    renderJSONInline={true}
                    useCodeInput={true}
                    showFullscreenButton={true}
                    sparse={sparse}
                    allowConfigBacking={isConfigBacked}
                    configBackingOptionKeys={configBackingOptionKeys}
                    configBackingShowPatch={isConfigBacked}
                    lockConfigBacking={isConfigBacked}
                  />
                  {isNewVariation && numLinkedChanges > 1 && (
                    <Callout status="warning" mt="2">
                      <Text weight="semibold">Don&apos;t forget!</Text> Define
                      values for this new variation in other implementations
                      too.
                    </Callout>
                  )}
                  {i < fields.length - 1 && <Separator size="4" my="4" />}
                </Box>
              );
            })}
          </Flex>
          <Separator size="4" mt="4" mb="6" />
          <Link
            href="#"
            onClick={(e) => {
              e.preventDefault();
              handleAddVariation();
            }}
          >
            <PiPlusCircleFill /> Add Variation
          </Link>
        </>
      )}
    </ModalStandard>
  );
}
