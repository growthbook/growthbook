import { FeatureInterface, FeatureValueType } from "shared/types/feature";
import { Box, Flex, Grid, Slider } from "@radix-ui/themes";
import {
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
import styles from "@/components/Features/VariationsInput.module.scss";
import ExperimentSplitVisual from "@/components/Features/ExperimentSplitVisual";
import SortableVariationsList from "@/components/Features/SortableVariationsList";
import {
  SortableManagedVariationRow,
  ManagedSortableVariation,
  gridColumns,
} from "./ExperimentManagedFeatureVariationRow";

const COVERAGE_LABEL = "Traffic included in this Experiment";

export interface Props {
  valueType?: FeatureValueType;
  variations?: ManagedSortableVariation[];
  setWeight?: (i: number, weight: number) => void;
  setVariations?: (variations: ManagedSortableVariation[]) => void;
  coverage?: number;
  setCoverage?: (coverage: number) => void;
  // null drops the info icon entirely.
  coverageTooltip?: string | null;
  valueAsId?: boolean;
  showPreview?: boolean;
  // Rendered between the coverage widget and the variations table.
  belowCoverage?: ReactNode;
  hideSplits?: boolean;
  label?: string | null;
  feature?: FeatureInterface;
  autoFocusVariationId?: string | null;
  // Appends a variation once on mount and focuses its Name field.
  autoAddVariationOnMount?: boolean;
  // JSON only: render each value as a sparse patch onto the feature default.
  // Callers own the toggle, since it's a rule-level flag.
  sparse?: boolean;
}

export default function ExperimentManagedFeatureVariationEditor({
  variations,
  setVariations,
  setWeight,
  coverage,
  setCoverage,
  valueType,
  coverageTooltip = "Users not included in the Experiment will skip this rule",
  valueAsId = false,
  showPreview = true,
  belowCoverage,
  hideSplits = false,
  label: _label,
  feature,
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

  const [editingSplits, setEditingSplits] = useState(false);
  const [editingIds, setEditingIds] = useState(!idsMatchIndexes);
  // JSON needs the room, and advanced mode spends the row's width on the id
  // and description columns; both put the value on its own row.
  const stackValue = valueType === "json" || editingIds;

  // The reorder gutter only earns its space while rows can actually be moved.
  const showDragHandle = !!setVariations && (variations?.length ?? 0) > 1;

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

      {belowCoverage}

      {!valueAsId && setVariations && (
        <Box mb="2">
          {!editingIds ? (
            <Link
              onClick={() => {
                setEditingIds(true);
              }}
            >
              Switch to advanced mode
            </Link>
          ) : (
            <Text color="text-mid">Advanced mode</Text>
          )}
        </Box>
      )}

      {
        <Box>
          <Grid
            columns={gridColumns({
              hideValueField: !editingIds,
              showDescription: editingIds,
              hideSplit: hideSplits,
              stackValue,
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
                Variation Name
              </Text>
              {!stackValue && (
                <Text size="md" weight="semibold">
                  Value
                </Text>
              )}
              {editingIds && (
                <Text size="md" weight="semibold">
                  Description
                </Text>
              )}
              {!hideSplits && (
                <Text size="md" weight="semibold">
                  <Flex align="center" gap="1">
                    <span>Split</span>
                    {!editingSplits && (
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
                    stackValue={stackValue}
                    showDragHandle={showDragHandle}
                    showDescription={editingIds}
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
            {variations && setWeight && (
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
