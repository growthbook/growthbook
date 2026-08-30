import { FeatureInterface, FeatureValueType } from "shared/types/feature";
import { Box, Flex, Grid, Slider } from "@radix-ui/themes";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getEqualWeights } from "shared/experiments";
import {
  PiArrowsClockwise,
  PiLockSimpleFill,
  PiPlusBold,
} from "react-icons/pi";
import {
  decimalToPercent,
  distributeWeights,
  percentToDecimal,
  percentToDecimalForNumber,
} from "@/services/utils";
import {
  generateVariationId,
  getDefaultVariationValue,
} from "@/services/features";
import { GBInfo } from "@/components/Icons";
import Field from "@/components/Forms/Field";
import Link from "@/ui/Link";
import Button from "@/ui/Button";
import Text from "@/ui/Text";
import Tooltip from "@/ui/Tooltip";
import styles from "./VariationsInput.module.scss";
import ExperimentSplitVisual from "./ExperimentSplitVisual";
import {
  SortableFeatureVariationRow,
  gridColumns,
  SortableVariation,
} from "./SortableFeatureVariationRow";
import SortableVariationsList from "./SortableVariationsList";

export interface Props {
  valueType?: FeatureValueType;
  defaultValue?: string;
  variations?: SortableVariation[];
  setWeight?: (i: number, weight: number) => void;
  setVariations?: (variations: SortableVariation[]) => void;
  coverage?: number;
  setCoverage?: (coverage: number) => void;
  coverageLabel?: string;
  coverageTooltip?: string;
  valueAsId?: boolean;
  hideVariationIds?: boolean;
  startEditingIndexes?: boolean;
  startEditingSplits?: boolean;
  showPreview?: boolean;
  hideCoverage?: boolean;
  disableCoverage?: boolean;
  disableVariations?: boolean;
  disableCustomSplit?: boolean;
  hideSplits?: boolean;
  label?: string | null;
  feature?: FeatureInterface;
  hideVariations?: boolean;
  showDescriptions?: boolean;
  simple?: boolean;
  onlySafeToEditVariationMetadata?: boolean;
  // When set, the variation with this id has its Name field auto-focused on
  // mount.
  autoFocusVariationId?: string | null;
  // When true, a new variation is appended once on mount (reusing the same
  // "Add variation" behavior) and its Name field is auto-focused.
  autoAddVariationOnMount?: boolean;
  // JSON features only. When true, each variation value is rendered as a sparse
  // patch (merged onto the feature default). Pass-through to the value editor;
  // callers own the sparse toggle since it's a rule-level flag.
  sparse?: boolean;
}

export default function FeatureVariationsInput({
  variations,
  setVariations,
  setWeight,
  coverage,
  setCoverage,
  valueType,
  defaultValue = "",
  coverageLabel = "Traffic included in this Experiment",
  coverageTooltip = "Users not included in the Experiment will skip this rule",
  valueAsId = false,
  hideVariationIds = false,
  startEditingIndexes = false,
  startEditingSplits = false,
  showPreview = true,
  hideCoverage = false,
  disableCoverage = false,
  disableVariations = false,
  disableCustomSplit = false,
  hideSplits = false,
  label: _label,
  feature,
  hideVariations,
  showDescriptions,
  simple,
  onlySafeToEditVariationMetadata,
  autoFocusVariationId,
  autoAddVariationOnMount,
  sparse,
}: Props) {
  const weights = useMemo(
    () => variations?.map((v) => v.weight) || [],
    [variations],
  );
  const isEqualWeights = weights?.every(
    (w) => Math.abs(w - weights[0]) < 0.0001,
  );

  const idsMatchIndexes = variations?.every((v, i) => v.value === i + "");

  const [editingSplits, setEditingSplits] = useState(startEditingSplits);
  const [editingIds, setEditingIds] = useState(
    startEditingIndexes || !idsMatchIndexes,
  );
  const [numberOfVariations, setNumberOfVariations] = useState(
    Math.max(variations?.length ?? 2, 2) + "",
  );
  // Leaving advanced mode drops what only it can author: bespoke ids fall back
  // to the index. Descriptions are not advanced-only here — `showDescriptions`
  // is the caller's call — so they are left alone.
  const exitAdvancedMode = () => {
    setEditingIds(false);
    if (!variations || !setVariations) return;
    setVariations(variations.map((v, i) => ({ ...v, value: i + "" })));
  };

  // editingIds already encodes the notion of having bespoke IDs, so if it is false
  // it is probably safe to renormalize variation keys on sort
  // The reorder gutter only earns its space while rows can actually be moved.
  const showDragHandle =
    !!setVariations &&
    !disableVariations &&
    !onlySafeToEditVariationMetadata &&
    (variations?.length ?? 0) > 1;

  const forceRenormalizeVariationKeysOnSort =
    !valueAsId && !editingIds && !onlySafeToEditVariationMetadata;

  const setEqualWeights = () => {
    if (!variations || !setWeight) return;
    getEqualWeights(variations.length).forEach((w, i) => {
      setWeight(i, w);
    });
  };

  const addVariation = useCallback((): string | null => {
    if (!variations || !setVariations) return null;
    const newWeights = distributeWeights([...weights, 0], editingSplits);
    const newId = generateVariationId();
    const newValues = [
      ...variations,
      {
        value: getDefaultVariationValue(defaultValue),
        name: `Variation ${variations.length}`,
        weight: 0,
        id: newId,
      },
    ];
    newValues.forEach((v, i) => {
      v.weight = newWeights[i] || 0;
    });
    setVariations(newValues);
    if (isEqualWeights && setWeight) {
      getEqualWeights(newValues.length).forEach((w, i) => setWeight(i, w));
    }
    return newId;
  }, [
    variations,
    setVariations,
    setWeight,
    weights,
    editingSplits,
    isEqualWeights,
    defaultValue,
  ]);

  // Id of a variation added on mount via autoAddVariationOnMount; used to
  // auto-focus its Name field.
  const [autoAddedVariationId, setAutoAddedVariationId] = useState<
    string | null
  >(null);
  const didAutoAddRef = useRef(false);
  useEffect(() => {
    if (!autoAddVariationOnMount || didAutoAddRef.current) return;
    didAutoAddRef.current = true;
    const newId = addVariation();
    if (newId !== null) {
      setAutoAddedVariationId(newId);
      setNumberOfVariations((variations?.length ?? 0) + 1 + "");
    }
    // Only run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoAddVariationOnMount]);

  const focusVariationId = autoAddedVariationId ?? autoFocusVariationId ?? null;

  const label = _label
    ? _label
    : simple
      ? "Traffic Percentage & Variations"
      : setVariations
        ? "Traffic Percentage, Variations, and Weights"
        : hideCoverage || hideVariations
          ? "Traffic Percentage"
          : "Traffic Percentage & Variation Weights";

  return (
    <Box mb="4">
      {_label !== null ? (
        <Text as="label" weight="semibold">
          {label}
        </Text>
      ) : null}
      {simple ? (
        <>
          {!hideCoverage ? (
            <Box px="4" pt="4" mb="6" className="bg-highlight rounded">
              <Text as="label" mb="0">
                {coverageLabel}{" "}
                <Tooltip content={coverageTooltip} side="top">
                  <Box
                    as="span"
                    display="inline-block"
                    tabIndex={0}
                    aria-label={`More information about ${coverageLabel}`}
                  >
                    <GBInfo />
                  </Box>
                </Tooltip>
              </Text>
              <Flex align="center" pb="4" gap="3">
                <Box flexGrow="1">
                  <Slider
                    value={
                      isNaN(coverage ?? 0)
                        ? [0]
                        : [decimalToPercent(coverage ?? 0)]
                    }
                    min={0}
                    max={100}
                    step={1}
                    disabled={!!disableCoverage}
                    onValueChange={(e) => {
                      let decimal = percentToDecimalForNumber(e[0]);
                      if (decimal > 1) decimal = 1;
                      if (decimal < 0) decimal = 0;
                      setCoverage?.(decimal);
                    }}
                  />
                </Box>
                <Box>
                  <Box position="relative" className={styles.percentInputWrap}>
                    <Field
                      size="legacy"
                      style={{ width: 95 }}
                      value={
                        isNaN(coverage ?? 0)
                          ? ""
                          : decimalToPercent(coverage ?? 0)
                      }
                      onChange={(e) => {
                        let decimal = percentToDecimal(e.target.value);
                        if (decimal > 1) decimal = 1;
                        if (decimal < 0) decimal = 0;
                        setCoverage?.(decimal);
                      }}
                      type="number"
                      min={0}
                      max={100}
                      step="1"
                      disabled={!!disableCoverage}
                    />
                    <Text as="span">%</Text>
                  </Box>
                </Box>
              </Flex>
            </Box>
          ) : null}
          <Field
            size="legacy"
            label="Number of Variations"
            type="number"
            value={numberOfVariations}
            disabled={onlySafeToEditVariationMetadata}
            onChange={(e) => setNumberOfVariations(e?.target?.value ?? "2")}
            onBlur={(e) => {
              let n = parseInt(e?.target?.value ?? numberOfVariations);
              n = Math.min(Math.max(2, n), 100);
              const newValues: SortableVariation[] = [];
              for (let i = 0; i < n; i++) {
                newValues.push({
                  value: getDefaultVariationValue(defaultValue),
                  name: i === 0 ? "Control" : `Variation ${i}`,
                  weight: 1 / n,
                  id: generateVariationId(),
                });
              }
              setVariations?.(newValues);
              setNumberOfVariations(n + "");
            }}
          />
        </>
      ) : (
        <>
          {!hideCoverage ? (
            <Box px="4" pt="4" mb="6" className="bg-highlight rounded">
              <Text as="label" mb="0">
                {coverageLabel}{" "}
                <Tooltip content={coverageTooltip} side="top">
                  <Box
                    as="span"
                    display="inline-block"
                    tabIndex={0}
                    aria-label={`More information about ${coverageLabel}`}
                  >
                    <GBInfo />
                  </Box>
                </Tooltip>
              </Text>
              <Flex align="center" pb="4" gap="3">
                <Box flexGrow="1">
                  <Slider
                    value={
                      isNaN(coverage ?? 0)
                        ? [0]
                        : [decimalToPercent(coverage ?? 0)]
                    }
                    min={0}
                    max={100}
                    step={1}
                    disabled={!!disableCoverage}
                    onValueChange={(e) => {
                      let decimal = percentToDecimalForNumber(e[0]);
                      if (decimal > 1) decimal = 1;
                      if (decimal < 0) decimal = 0;
                      setCoverage?.(decimal);
                    }}
                  />
                </Box>
                <Box>
                  <Box position="relative" className={styles.percentInputWrap}>
                    <Field
                      size="legacy"
                      style={{ width: 95 }}
                      value={
                        isNaN(coverage ?? 0)
                          ? ""
                          : decimalToPercent(coverage ?? 0)
                      }
                      onChange={(e) => {
                        let decimal = percentToDecimal(e.target.value);
                        if (decimal > 1) decimal = 1;
                        if (decimal < 0) decimal = 0;
                        setCoverage?.(decimal);
                      }}
                      type="number"
                      min={0}
                      max={100}
                      step="1"
                      disabled={
                        !!disableCoverage && onlySafeToEditVariationMetadata
                      }
                    />
                    <Text as="span">%</Text>
                  </Box>
                </Box>
              </Flex>
              {showPreview && coverage !== undefined && variations ? (
                <Box pb="4">
                  <ExperimentSplitVisual
                    coverage={coverage}
                    values={variations}
                    type={valueType ?? "string"}
                  />
                </Box>
              ) : null}
            </Box>
          ) : null}

          {!hideVariationIds &&
            !startEditingIndexes &&
            !valueAsId &&
            !disableVariations &&
            setVariations && (
              <Box mb="2">
                <Link
                  onClick={() => {
                    if (editingIds) {
                      exitAdvancedMode();
                    } else {
                      setEditingIds(true);
                    }
                  }}
                >
                  {editingIds
                    ? "Switch to simple mode"
                    : "Switch to advanced mode"}
                </Link>
              </Box>
            )}

          {!hideVariations && (
            <Box>
              <Grid
                columns={gridColumns({
                  hideVariationIds,
                  hideValueField: !editingIds,
                  showDescription: showDescriptions,
                  hideSplit: hideSplits,
                  isJson: valueType === "json",
                  showDragHandle,
                })}
                gapX="4"
                gapY="2"
                align="center"
                px="2"
                pt="3"
                pb="2"
              >
                <>
                  {showDragHandle && <span />}
                  {!hideVariationIds && (
                    <Text size="md" weight="semibold">
                      {!valueAsId && editingIds ? "#" : "Id"}
                    </Text>
                  )}
                  {editingIds && (
                    <Text size="md" weight="semibold">
                      {hideVariationIds && !valueAsId ? "Value to Force" : "Id"}
                    </Text>
                  )}
                  <Text size="md" weight="semibold">
                    Variation Name
                  </Text>
                  {showDescriptions && (
                    <Text size="md" weight="semibold">
                      Description
                    </Text>
                  )}
                  {!hideSplits && (
                    <Text size="md" weight="semibold">
                      <Flex align="center" gap="1">
                        <span>Split</span>
                        {!disableVariations &&
                          !disableCustomSplit &&
                          !editingSplits &&
                          !onlySafeToEditVariationMetadata && (
                            <Tooltip content="Customize split" side="top">
                              <Link
                                onClick={(e) => {
                                  e.preventDefault();
                                  setEditingSplits(true);
                                }}
                                aria-label="Customize split"
                              >
                                <PiLockSimpleFill size={15} />
                              </Link>
                            </Tooltip>
                          )}
                        {editingSplits &&
                          !isEqualWeights &&
                          !disableCustomSplit &&
                          !hideSplits && (
                            <Tooltip
                              content="Assign equal weights to all variations"
                              side="top"
                            >
                              <Link
                                onClick={(e) => {
                                  e.preventDefault();
                                  setEqualWeights();
                                }}
                                aria-label="Set equal weights"
                              >
                                <Flex align="center" gap="1">
                                  <PiArrowsClockwise size={12} />
                                  <Box as="span" style={{ fontSize: "11px" }}>
                                    set equal
                                  </Box>
                                </Flex>
                              </Link>
                            </Tooltip>
                          )}
                      </Flex>
                    </Text>
                  )}
                  <span />
                </>
              </Grid>
              <div>
                {variations && (
                  <SortableVariationsList
                    valuesAsIds={idsMatchIndexes}
                    forceRenormalizeVariationKeysOnSort={
                      forceRenormalizeVariationKeysOnSort
                    }
                    variations={variations}
                    setVariations={
                      !disableVariations ? setVariations : undefined
                    }
                  >
                    {variations.map((variation, i) => (
                      <SortableFeatureVariationRow
                        i={i}
                        key={variation.id}
                        variation={variation}
                        variations={variations}
                        setVariations={
                          !disableVariations ? setVariations : undefined
                        }
                        setWeight={!disableVariations ? setWeight : undefined}
                        onlySafeToEditVariationMetadata={
                          onlySafeToEditVariationMetadata
                        }
                        customSplit={editingSplits}
                        valueType={valueType}
                        valueAsId={valueAsId}
                        hideVariationIds={hideVariationIds}
                        hideValueField={!editingIds}
                        hideSplit={hideSplits}
                        feature={feature}
                        showDescription={showDescriptions}
                        showDragHandle={showDragHandle}
                        autoFocusName={
                          focusVariationId !== null &&
                          variation.id === focusVariationId
                        }
                        sparse={sparse}
                      />
                    ))}
                  </SortableVariationsList>
                )}
              </div>
              <div>
                {!disableVariations &&
                  variations &&
                  setWeight &&
                  !onlySafeToEditVariationMetadata && (
                    <Box my="4">
                      <Box>
                        {valueType !== "boolean" && setVariations && (
                          <Button
                            variant="ghost"
                            icon={<PiPlusBold />}
                            onClick={() => {
                              addVariation();
                            }}
                          >
                            Add variation
                          </Button>
                        )}
                        {valueType === "boolean" && (
                          <Tooltip
                            content="Boolean features can only have two variations. Use a different feature type to add multiple variations."
                            side="top"
                          >
                            <Button
                              variant="ghost"
                              icon={<PiPlusBold />}
                              disabled
                            >
                              Add variation
                            </Button>
                          </Tooltip>
                        )}
                      </Box>
                    </Box>
                  )}
              </div>
            </Box>
          )}
        </>
      )}
    </Box>
  );
}
