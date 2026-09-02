import { FeatureInterface, FeatureValueType } from "shared/types/feature";
import { Box, Flex, Grid, IconButton, Slider } from "@radix-ui/themes";
import {
  ComponentProps,
  ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { getEqualWeights } from "shared/experiments";
import {
  PiArrowsClockwise,
  PiInfo,
  PiPencilSimpleFill,
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
import Callout from "@/ui/Callout";
import Button from "@/ui/Button";
import Text from "@/ui/Text";
import Switch from "@/ui/Switch";
import Tooltip from "@/ui/Tooltip";
import styles from "@/components/Features/VariationsInput.module.scss";
import ExperimentSplitVisual from "@/components/Features/ExperimentSplitVisual";
import SortableVariationsList from "@/components/Features/SortableVariationsList";
import {
  ManagedSortableVariation,
  SortableManagedVariationRow,
  gridColumns,
} from "./ExperimentManagedFeatureVariationRow";

const COVERAGE_LABEL = "Traffic included in this experiment";

export interface Props {
  valueType?: FeatureValueType;
  variations?: ManagedSortableVariation[];
  setWeight?: (i: number, weight: number) => void;
  setVariations?: (variations: ManagedSortableVariation[]) => void;
  coverage?: number;
  setCoverage?: (coverage: number) => void;
  // null drops the info icon entirely.
  coverageTooltip?: string | null;
  // A running experiment cannot move its traffic split from here.
  hideCoverage?: boolean;
  valueAsId?: boolean;
  showPreview?: boolean;
  // Rendered between the coverage widget and the variations table.
  belowCoverage?: ReactNode;
  // Column name: "Value", or "Feature Value" for a flag the experiment doesn't own.
  valueLabel?: string;
  // Locks the served value until the caller opts into editing it.
  valueDisabled?: boolean;
  // No flag yet: drop the value column until one is being adopted.
  hideFeatureValue?: boolean;
  // Unlocks it, from the value column header and each stacked row label.
  onEditValues?: () => void;
  // Opts into values before there is a flag; sits in the name header.
  onAddValues?: () => void;
  // Explains where an edit lands. null drops the info icon entirely.
  valueTooltip?: string | null;
  hideSplits?: boolean;
  // Values stay editable; changing the variation set or weights re-buckets.
  lockStructure?: boolean;
  label?: string | null;
  feature?: FeatureInterface;
  // Scopes the "Insert constant" picker before the flag exists.
  constantContext?: ComponentProps<
    typeof SortableManagedVariationRow
  >["constantContext"];
  autoFocusVariationId?: string | null;
  // Appends a variation once on mount and focuses its Name field.
  autoAddVariationOnMount?: boolean;
  // JSON only: render each value as a sparse patch onto the feature default.
  // Callers own the toggle, since it's a rule-level flag.
  sparse?: boolean;
  // The first variation's value IS the feature default (a managed flag stores
  // it as such), so it states the whole value and is never a patch.
  controlIsDefault?: boolean;
}

export default function ExperimentManagedFeatureVariationEditor({
  variations,
  setVariations,
  setWeight,
  coverage,
  setCoverage,
  valueType,
  coverageTooltip = "Users not included in the experiment will skip this rule",
  hideCoverage = false,
  valueAsId = false,
  showPreview = true,
  belowCoverage,
  valueLabel = "Value",
  valueDisabled,
  hideFeatureValue,
  onEditValues,
  onAddValues,
  valueTooltip,
  hideSplits = false,
  lockStructure = false,
  label: _label,
  feature,
  constantContext,
  autoFocusVariationId,
  autoAddVariationOnMount,
  sparse,
  controlIsDefault = false,
}: Props) {
  const weights = useMemo(
    () => variations?.map((v) => v.weight) || [],
    [variations],
  );
  const isEqualWeights = weights?.every(
    (w) => Math.abs(w - weights[0]) < 0.0001,
  );

  const idsMatchIndexes = variations?.every((v, i) => v.value === i + "");

  const [editingSplits, setEditingSplits] = useState(false);
  const [editingIds, setEditingIds] = useState(!idsMatchIndexes);
  // Leaving advanced mode drops what only it can author: bespoke ids.
  const exitAdvancedMode = () => {
    setEditingIds(false);
    if (!variations || !setVariations) return;
    setVariations(variations.map((v, i) => ({ ...v, value: i + "" })));
  };

  // Mirrors the Advanced switch's own condition: no warning about a control
  // that isn't there.
  const canToggleAdvanced = !valueAsId && !!setVariations && !lockStructure;

  // Only a JSON value needs a row of its own.
  const stackValue = valueType === "json";

  // The reorder gutter only earns its space while rows can actually be moved.
  const showDragHandle =
    !!setVariations && !lockStructure && (variations?.length ?? 0) > 1;

  // editingIds already encodes the notion of having bespoke IDs, so if it is false
  // it is probably safe to renormalize variation keys on sort
  const forceRenormalizeVariationKeysOnSort = !valueAsId && !editingIds;

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
        value: getDefaultVariationValue(""),
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
  ]);

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
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoAddVariationOnMount]);

  const focusVariationId = autoAddedVariationId ?? autoFocusVariationId ?? null;

  const label =
    _label ??
    (setVariations
      ? "Traffic Percentage, Variations, and Weights"
      : "Traffic Percentage & Variation Weights");

  return (
    <Box mb="4">
      {_label !== null ? (
        <Text as="label" weight="semibold">
          {label}
        </Text>
      ) : null}
      {hideCoverage ? null : (
        <Box px="4" pt="4" mb="6" className="bg-highlight rounded">
          <Text as="label" mb="0">
            {COVERAGE_LABEL}
            {coverageTooltip ? (
              <>
                {" "}
                <Tooltip content={coverageTooltip} side="top">
                  <Box
                    as="span"
                    display="inline-block"
                    tabIndex={0}
                    aria-label={`More information about ${COVERAGE_LABEL}`}
                  >
                    <GBInfo />
                  </Box>
                </Tooltip>
              </>
            ) : null}
          </Text>
          <Flex align="center" pb="4" gap="3">
            <Box flexGrow="1">
              <Slider
                value={
                  isNaN(coverage ?? 0) ? [0] : [decimalToPercent(coverage ?? 0)]
                }
                min={0}
                max={100}
                step={1}
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
                  size="md"
                  style={{ width: 95 }}
                  value={
                    isNaN(coverage ?? 0) ? "" : decimalToPercent(coverage ?? 0)
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
      )}

      {belowCoverage}

      {/* Only when the reset would actually change something: with ids
          already at their position, leaving advanced mode is a no-op. */}
      {canToggleAdvanced &&
        editingIds &&
        !!variations?.length &&
        !idsMatchIndexes && (
          <Callout status="warning" size="sm" mb="3">
            Turning off Advanced resets variation ids to their position (0, 1,
            2&hellip;).
          </Callout>
        )}

      {
        <Box>
          <Grid
            columns={gridColumns({
              hideValueField: !editingIds,
              hideSplit: hideSplits,
              stackValue,
              hideFeatureValue,
              showDragHandle,
            })}
            gap="4"
            align="center"
            px="2"
            pt="3"
            pb="2"
          >
            <>
              {showDragHandle && <span />}
              <Text size="md" weight="semibold">
                {!valueAsId && editingIds ? "#" : "Id"}
              </Text>
              {editingIds && (
                <Text size="md" weight="semibold">
                  Id
                </Text>
              )}
              <Text size="md" weight="semibold">
                <Flex align="center" gap="4">
                  <span>Variation Name</span>
                  {onAddValues && (
                    <Link onClick={onAddValues} weight="medium">
                      <Flex align="center" gap="1">
                        <PiPlusBold />
                        Add variation values
                      </Flex>
                    </Link>
                  )}
                </Flex>
              </Text>
              {!stackValue && !hideFeatureValue && (
                <Text size="md" weight="semibold">
                  <Flex align="center" gap="1">
                    <span>{valueLabel}</span>
                    {valueTooltip ? (
                      <Tooltip content={valueTooltip} side="top">
                        <Flex
                          align="center"
                          style={{ color: "var(--color-text-low)" }}
                        >
                          <PiInfo />
                        </Flex>
                      </Tooltip>
                    ) : null}
                    {onEditValues && (
                      <Tooltip content="Edit feature values" side="top">
                        <IconButton
                          variant="ghost"
                          color="violet"
                          radius="full"
                          size="1"
                          style={{ margin: 0 }}
                          onClick={(e) => {
                            e.preventDefault();
                            onEditValues();
                          }}
                          aria-label="Edit feature values"
                        >
                          <PiPencilSimpleFill size={14} />
                        </IconButton>
                      </Tooltip>
                    )}
                  </Flex>
                </Text>
              )}
              {!hideSplits && (
                <Text size="md" weight="semibold">
                  <Flex direction="column" gap="1" align="start">
                    <Flex align="center" gap="1">
                      <span>Split</span>
                      {!editingSplits && (
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
                    {editingSplits && !isEqualWeights && !hideSplits && (
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
                      onChange={(on) => {
                        if (on) {
                          setEditingIds(true);
                        } else {
                          exitAdvancedMode();
                        }
                      }}
                    />
                  </Box>
                </Box>
              ) : (
                <span />
              )}
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
                setVariations={setVariations}
              >
                {variations.map((variation, i) => (
                  <SortableManagedVariationRow
                    i={i}
                    key={variation.id}
                    variation={variation}
                    variations={variations}
                    setVariations={setVariations}
                    setWeight={setWeight}
                    customSplit={editingSplits}
                    valueType={valueType}
                    valueAsId={valueAsId}
                    hideValueField={!editingIds}
                    hideSplit={hideSplits}
                    feature={feature}
                    constantContext={constantContext}
                    stackValue={stackValue}
                    valueLabel={valueLabel}
                    valueDisabled={valueDisabled}
                    onEditValues={onEditValues}
                    valueTooltip={valueTooltip}
                    hideFeatureValue={hideFeatureValue}
                    showDragHandle={showDragHandle}
                    lockStructure={lockStructure}
                    autoFocusName={
                      focusVariationId !== null &&
                      variation.id === focusVariationId
                    }
                    sparse={sparse && !(controlIsDefault && i === 0)}
                  />
                ))}
              </SortableVariationsList>
            )}
          </div>
          <div>
            {variations && setWeight && (
              <Box my="4">
                <Box>
                  {valueType !== "boolean" &&
                    setVariations &&
                    !lockStructure && (
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
              </Box>
            )}
          </div>
        </Box>
      }
    </Box>
  );
}
