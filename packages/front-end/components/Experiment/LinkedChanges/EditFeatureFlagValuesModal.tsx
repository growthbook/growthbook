import { useEffect, useMemo, useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { FeatureInterface } from "shared/types/feature";
import { MinimalFeatureRevisionInterface } from "shared/types/feature-revision";
import {
  ExperimentInterfaceStringDates,
  LinkedFeatureInfo,
} from "shared/types/experiment";
import { ExperimentRefVariation, Screenshot } from "shared/validators";
import { getEqualWeights, getLatestPhaseVariations } from "shared/experiments";
import {
  validateFeatureValue,
  getReviewSetting,
  generateVariationId,
} from "shared/util";
import { BsThreeDotsVertical } from "react-icons/bs";
import { Box, Flex, IconButton, Separator } from "@radix-ui/themes";
import { PiPlusCircleFill } from "react-icons/pi";
import { useAuth } from "@/services/auth";
import useApi from "@/hooks/useApi";
import useOrgSettings from "@/hooks/useOrgSettings";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import DraftSelectorDropdown, {
  DraftMode,
} from "@/components/Features/DraftSelectorDropdown";
import { useDefaultDraft } from "@/hooks/useDefaultDraft";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import FeatureValueField from "@/components/Features/FeatureValueField";
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

export interface Props {
  feature: FeatureInterface;
  experiment: ExperimentInterfaceStringDates;
  info: LinkedFeatureInfo;
  numLinkedChanges: number;
  close: () => void;
  mutate: () => void;
}

type FeatureRevisionResponse = {
  revisionList: MinimalFeatureRevisionInterface[];
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
  info,
  numLinkedChanges,
  close,
  mutate,
}: Props) {
  const { apiCall } = useAuth();
  const settings = useOrgSettings();
  const permissionsUtil = usePermissionsUtil();

  const { data, error } = useApi<FeatureRevisionResponse>(
    `/feature/${feature.id}`,
  );
  const revisionList = data?.revisionList ?? [];

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
        description: v.description ?? "",
        key: v.key,
        screenshots: v.screenshots ?? [],
        weight: latestPhase?.variationWeights?.[i] ?? 0,
        value: info.values.find((x) => x.variationId === v.id)?.value ?? "",
      })),
    [phaseVariations, latestPhase?.variationWeights, info.values],
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

  const isAdmin = permissionsUtil.canBypassApprovalChecks(feature);
  const canAutoPublish = isAdmin || gatedEnvSet === "none";

  const defaultDraft = useDefaultDraft(revisionList);

  // The linking flow always creates a pending draft that adds the
  // experiment-ref rule, so live doesn't have the rule yet. In that state,
  // "Apply now" (publish to live) would fail on the back-end because there's
  // no rule on live to update. Force the modal into the only path that works:
  // save the change to the existing draft that already adds the rule.
  const ruleOnlyOnDraft =
    info.state === "draft" &&
    !info.liveHasMatchingRule &&
    info.draftRevisionVersion != null;

  const initialMode: DraftMode = ruleOnlyOnDraft
    ? "existing"
    : defaultDraft != null
      ? "existing"
      : canAutoPublish
        ? "publish"
        : "new";
  const initialSelectedDraft = ruleOnlyOnDraft
    ? (info.draftRevisionVersion ?? null)
    : defaultDraft;

  const [mode, setMode] = useState<DraftMode>(initialMode);
  const [selectedDraft, setSelectedDraft] = useState<number | null>(
    initialSelectedDraft,
  );
  const [isEditingVariations, setIsEditingVariations] = useState(false);

  useEffect(() => {
    if (!canAutoPublish && mode === "publish") {
      setMode("new");
    }
  }, [canAutoPublish, mode]);

  const watchedVariations = form.watch("variations");

  const weightSum = (watchedVariations ?? []).reduce(
    (acc, v) => acc + (Number(v?.weight) || 0),
    0,
  );
  const weightSumPct = decimalToPercent(weightSum);
  const weightsOutOfBalance = Math.abs(weightSum - 1) > 1e-4;

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

  const handleAddVariation = () => {
    const currentRows = form.getValues("variations") ?? [];
    const currentWeights = currentRows.map((v) => Number(v?.weight) || 0);
    const wasEqualWeights =
      currentWeights.length > 0 &&
      currentWeights.every((w) => Math.abs(w - currentWeights[0]) < 0.0001);

    append({
      id: generateVariationId(),
      name: `Variation ${fields.length}`,
      description: "",
      key: String(fields.length),
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
          setMode={setMode}
          selectedDraft={selectedDraft}
          setSelectedDraft={setSelectedDraft}
          canAutoPublish={ruleOnlyOnDraft ? false : canAutoPublish}
          gatedEnvSet={gatedEnvSet}
          locked={ruleOnlyOnDraft}
          lockedTooltip={
            ruleOnlyOnDraft
              ? "This experiment rule is added in this draft revision. Changes will be saved to it."
              : undefined
          }
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
          mode === "publish"
            ? { autoPublish: true }
            : mode === "existing" && selectedDraft != null
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
                  revisionOptions,
                },
              },
            }),
          },
        );

        await mutate();
      })}
      cta={mode === "publish" ? "Publish now" : "Save to draft"}
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
          {isEditingVariations && weightsOutOfBalance && (
            <Callout status="warning" my="2">
              Variation splits must sum to 100% — currently {weightSumPct}%.
            </Callout>
          )}
          <Flex direction="column" gap="3" pt="2">
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
                        <Field
                          label="Description"
                          containerClassName="mb-0"
                          {...form.register(`variations.${i}.description`)}
                        />
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
                              remove(i);
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
                          remove(i);
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
