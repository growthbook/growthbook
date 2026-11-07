import { FeatureInterface, FeatureValueType } from "shared/types/feature";
import { Box, Flex, Grid, IconButton, Slider } from "@radix-ui/themes";
import { ReactNode, useMemo, useState } from "react";
import { getEqualWeights } from "shared/experiments";
import {
  PiArrowsClockwise,
  PiPencilSimpleFill,
  PiPlusBold,
} from "react-icons/pi";
import {
  coverageToPercent,
  decimalToPercent,
  distributeWeights,
  isEqualSplit,
  percentToDecimalForNumber,
  typedPercentToCoverage,
} from "@/services/utils";
import {
  generateVariationId,
  getDefaultVariationValue,
} from "@/services/features";
import { GBInfo } from "@/components/Icons";
import Field from "@/components/Forms/Field";
import Link from "@/ui/Link";
import Callout from "@/ui/Callout";
import Button from "@/ui/Button";
import Text from "@/ui/Text";
import Switch from "@/ui/Switch";
import Tooltip from "@/ui/Tooltip";
import styles from "./VariationsInput.module.scss";
import ExperimentSplitVisual from "./ExperimentSplitVisual";
import {
  SortableFeatureVariationRow,
  gridColumns,
  SortableVariation,
  valueColumnIsKey,
} from "./SortableFeatureVariationRow";
import SortableVariationsList from "./SortableVariationsList";
import { ValueDiffProvider } from "./ValueDiffContext";

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
  sparse,
}: Props) {
  const weights = useMemo(
    () => variations?.map((v) => v.weight) || [],
    [variations],
  );
  const isEqualWeights = isEqualSplit(weights);

  const idsMatchIndexes = variations?.every((v, i) => v.value === i + "");

  const [editingSplits, setEditingSplits] = useState(startEditingSplits);
  const valueIsKey = valueColumnIsKey({ valueAsId, hideVariationIds });
  const [editingIds, setEditingIds] = useState(
    startEditingIndexes || !idsMatchIndexes,
  );
  const [numberOfVariations, setNumberOfVariations] = useState(
    Math.max(variations?.length ?? 2, 2) + "",
  );
  // Leaving advanced mode resets bespoke keys to their index.
  const exitAdvancedMode = () => {
    setEditingIds(false);
    if (!variations || !setVariations) return;
    setVariations(variations.map((v, i) => ({ ...v, value: i + "" })));
  };

  // Plain text when it can't be edited: every row's column fits the longest,
  // up to a point, so the names sit beside them.
  const valueWidth =
    (!setVariations || disableVariations || onlySafeToEditVariationMetadata) &&
    valueType !== "json"
      ? `${Math.min(24, Math.max(3, ...(variations ?? []).map((v) => v.value.length))) + 1}ch`
      : null;

  const showDragHandle =
    !!setVariations &&
    !disableVariations &&
    !onlySafeToEditVariationMetadata &&
    (variations?.length ?? 0) > 1;

  const canToggleAdvanced =
    !hideVariationIds &&
    !startEditingIndexes &&
    !valueAsId &&
    !disableVariations &&
    !onlySafeToEditVariationMetadata &&
    !!setVariations;

  // editingIds already encodes the notion of having bespoke IDs, so if it is false
  // it is probably safe to renormalize variation keys on sort
  const forceRenormalizeVariationKeysOnSort =
    !valueAsId && !editingIds && !onlySafeToEditVariationMetadata;
  // Drag and the row menu both reorder, so both renumber the same way.
  const renumberKeysOnReorder =
    !!idsMatchIndexes || forceRenormalizeVariationKeysOnSort;

  const setEqualWeights = () => {
    if (!variations || !setWeight) return;
    getEqualWeights(variations.length).forEach((w, i) => {
      setWeight(i, w);
    });
  };

  const addVariation = () => {
    if (!variations || !setVariations) return;
    const newWeights = distributeWeights([...weights, 0], editingSplits);
    const newValues = [
      ...variations,
      {
        value: getDefaultVariationValue(defaultValue),
        name: `Variation ${variations.length}`,
        weight: 0,
        id: generateVariationId(),
      },
    ];
    newValues.forEach((v, i) => {
      v.weight = newWeights[i] || 0;
    });
    setVariations(newValues);
    if (isEqualWeights && setWeight) {
      getEqualWeights(newValues.length).forEach((w, i) => setWeight(i, w));
    }
  };

  const label = _label
    ? _label
    : simple
      ? "Traffic Percentage & Variations"
      : setVariations
        ? "Traffic Percentage, Variations, and Weights"
        : hideCoverage || hideVariations
          ? "Traffic Percentage"
          : "Traffic Percentage & Variation Weights";
  // The slider's own label says it all, and there's nothing to set it apart from.
  const coverageAlone = !simple && !hideCoverage && !!hideVariations;

  return (
    <Box mb="4">
      {_label !== null && !coverageAlone ? (
        <Text as="label" weight="semibold">
          {label}
        </Text>
      ) : null}
      {simple ? (
        <>
          {!hideCoverage ? (
            <CoverageField
              coverage={coverage}
              setCoverage={setCoverage}
              label={coverageLabel}
              tooltip={coverageTooltip}
              disabled={disableCoverage}
              panel
            />
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
            <CoverageField
              coverage={coverage}
              setCoverage={setCoverage}
              label={coverageLabel}
              tooltip={coverageTooltip}
              disabled={disableCoverage}
              panel={!coverageAlone}
            >
              {showPreview &&
              !hideVariations &&
              coverage !== undefined &&
              variations ? (
                <Box pb="4">
                  <ExperimentSplitVisual
                    coverage={coverage}
                    values={variations}
                    type={valueType ?? "string"}
                  />
                </Box>
              ) : null}
            </CoverageField>
          ) : null}

          {canToggleAdvanced &&
            editingIds &&
            !!variations?.length &&
            !idsMatchIndexes && (
              <Callout status="warning" size="sm" mb="3">
                Turning off Advanced resets variation keys to their position (0,
                1, 2&hellip;).
              </Callout>
            )}

          {!hideVariations && (
            <Box>
              <Grid
                columns={gridColumns({
                  hideVariationIds,
                  hideValueField: !editingIds,
                  valueWidth,
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
                {showDragHandle && <span />}
                {!hideVariationIds && (
                  // Centered over the variation numbers.
                  <Text size="md" weight="semibold" align="center">
                    {editingIds ? "#" : "Key"}
                  </Text>
                )}
                {editingIds && (
                  <Text size="md" weight="semibold">
                    {valueIsKey ? "Key" : "Value to Force"}
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
                    <Flex direction="column" gap="1" align="start">
                      <Flex align="center" gap="1">
                        <span>Split</span>
                        {!disableVariations &&
                          !disableCustomSplit &&
                          !editingSplits &&
                          !onlySafeToEditVariationMetadata && (
                            <Tooltip content="Customize split" side="top">
                              <IconButton
                                variant="ghost"
                                color="violet"
                                radius="full"
                                size="1"
                                style={{ margin: 0 }}
                                onClick={(e) => {
                                  e.preventDefault();
                                  setEditingSplits(true);
                                }}
                                aria-label="Customize split"
                              >
                                <PiPencilSimpleFill size={14} />
                              </IconButton>
                            </Tooltip>
                          )}
                      </Flex>
                      {editingSplits &&
                        !isEqualWeights &&
                        !disableVariations &&
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
                {canToggleAdvanced ? (
                  <Box position="relative">
                    <Box
                      style={{
                        position: "absolute",
                        right: -8,
                        top: "50%",
                        transform: "translateY(-50%)",
                        whiteSpace: "nowrap",
                      }}
                    >
                      <Switch
                        size="sm"
                        label="Advanced"
                        value={editingIds}
                        onChange={(on) =>
                          on ? setEditingIds(true) : exitAdvancedMode()
                        }
                      />
                    </Box>
                  </Box>
                ) : (
                  <span />
                )}
              </Grid>
              {variations && (
                <ValueDiffProvider>
                  <SortableVariationsList
                    forceRenormalizeVariationKeysOnSort={renumberKeysOnReorder}
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
                        renumberKeysOnReorder={renumberKeysOnReorder}
                        hideVariationIds={hideVariationIds}
                        hideValueField={!editingIds}
                        valueWidth={valueWidth}
                        hideSplit={hideSplits}
                        feature={feature}
                        showDescription={showDescriptions}
                        showDragHandle={showDragHandle}
                        sparse={sparse}
                      />
                    ))}
                  </SortableVariationsList>
                </ValueDiffProvider>
              )}
              {!disableVariations &&
                variations &&
                setWeight &&
                !onlySafeToEditVariationMetadata && (
                  <Box my="4">
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
                        <Button variant="ghost" icon={<PiPlusBold />} disabled>
                          Add variation
                        </Button>
                      </Tooltip>
                    )}
                  </Box>
                )}
            </Box>
          )}
        </>
      )}
    </Box>
  );
}

// The included-traffic slider and its typed percentage.
function CoverageField({
  coverage,
  setCoverage,
  label,
  tooltip,
  disabled,
  panel,
  children,
}: {
  coverage?: number;
  setCoverage?: (coverage: number) => void;
  label: string;
  tooltip: string;
  disabled: boolean;
  // Sets it apart from the variations around it; alone, it needs none.
  panel: boolean;
  children?: ReactNode;
}) {
  const unset = isNaN(coverage ?? 0);
  const set = (decimal: number) =>
    setCoverage?.(Math.min(Math.max(decimal, 0), 1));
  return (
    <Box
      {...(panel && {
        px: "4",
        pt: "4",
        mb: "6",
        className: "bg-highlight rounded",
      })}
    >
      <Text as="label" weight="semibold" mb="0">
        {label}{" "}
        <Tooltip content={tooltip} side="top">
          <Box
            as="span"
            display="inline-block"
            tabIndex={0}
            aria-label={`More information about ${label}`}
          >
            <GBInfo />
          </Box>
        </Tooltip>
      </Text>
      <Flex align="center" pb={panel ? "4" : "0"} gap="3">
        <Box flexGrow="1">
          <Slider
            value={unset ? [0] : [decimalToPercent(coverage ?? 0)]}
            min={0}
            max={100}
            step={1}
            disabled={disabled}
            onValueChange={(e) => set(percentToDecimalForNumber(e[0]))}
          />
        </Box>
        <Box>
          <Box position="relative" className={styles.percentInputWrap}>
            <Field
              size="legacy"
              style={{ width: 95 }}
              value={unset ? "" : coverageToPercent(coverage ?? 0)}
              onChange={(e) => set(typedPercentToCoverage(e.target.value))}
              type="number"
              min={0}
              max={100}
              step="any"
              disabled={disabled}
            />
            <Text as="span">%</Text>
          </Box>
        </Box>
      </Flex>
      {children}
    </Box>
  );
}
