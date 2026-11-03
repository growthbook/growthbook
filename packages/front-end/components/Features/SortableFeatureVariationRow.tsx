import { forwardRef, useEffect, useState } from "react";
import { Box, Flex, Grid } from "@radix-ui/themes";
import { RiDraggable } from "react-icons/ri";
import { PiCaretDown, PiCaretUp } from "react-icons/pi";
import {
  ExperimentValue,
  FeatureInterface,
  FeatureValueType,
} from "shared/types/feature";
import {
  capTypedPercent,
  decimalToPercent,
  distributeWeights,
  floatRound,
  rebalance,
  VARIATION_WEIGHT_DECIMALS,
} from "@/services/utils";
import { getVariationDefaultName } from "@/services/features";
import Field from "@/components/Forms/Field";
import VariationNumber from "@/ui/VariationNumber";
import { FIVE_LINES_HEIGHT } from "@/components/Forms/CodeTextArea";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator,
  MoreMenuTrigger,
} from "@/ui/DropdownMenu";
import Text from "@/ui/Text";
import useSortableItem from "@/hooks/useSortableItem";
import TruncatedText from "@/ui/TruncatedText";
import FeatureValueField from "./FeatureValueField";
import { reorderVariations } from "./SortableVariationsList";
import styles from "./VariationsInput.module.scss";

// The column template the header row and every variation row share.
export function gridColumns({
  hideVariationIds,
  hideValueField,
  valueWidth = null,
  showDescription,
  hideSplit,
  isJson,
  showDragHandle,
}: {
  hideVariationIds?: boolean;
  hideValueField?: boolean;
  // A fixed width for plain-text values, the same in every row.
  valueWidth?: string | null;
  showDescription?: boolean;
  hideSplit?: boolean;
  isJson?: boolean;
  showDragHandle?: boolean;
}): string {
  return [
    showDragHandle ? "16px" : undefined,
    // Alone, the numbers are headed "Key": room for that word.
    hideVariationIds ? undefined : hideValueField ? "32px" : "16px",
    hideValueField
      ? undefined
      : isJson
        ? "minmax(300px, 2fr)"
        : (valueWidth ?? "minmax(120px, 1fr)"),
    "minmax(160px, 1fr)",
    showDescription ? "minmax(140px, 1fr)" : undefined,
    hideSplit ? undefined : "100px",
    // Room for the header's absolutely positioned Advanced switch.
    "48px",
  ]
    .filter(Boolean)
    .join(" ");
}

// A feature rule forces values; everywhere else the column holds variation keys.
export function valueColumnIsKey({
  valueAsId,
  hideVariationIds,
}: {
  valueAsId: boolean;
  hideVariationIds?: boolean;
}): boolean {
  return valueAsId || !hideVariationIds;
}

export type SortableVariation = ExperimentValue & {
  id: string;
  description?: string;
};

interface SortableProps {
  i: number;
  variation: SortableVariation;
  variations: SortableVariation[];
  valueType?: FeatureValueType;
  hideVariationIds?: boolean;
  hideValueField?: boolean;
  valueWidth?: string | null;
  setVariations?: (value: ExperimentValue[]) => void;
  setWeight?: (i: number, weight: number) => void;
  customSplit: boolean;
  hideSplit: boolean;
  valueAsId: boolean;
  // Renumber keys to their new positions on reorder, as a drag does.
  renumberKeysOnReorder?: boolean;
  feature?: FeatureInterface;
  showDescription?: boolean;
  showDragHandle?: boolean;
  dragging?: boolean;
  onlySafeToEditVariationMetadata?: boolean;
  // JSON features only. Renders the value as a sparse patch (merged onto the
  // feature default) in the value editor.
  sparse?: boolean;
}

type VariationProps = SortableProps &
  React.HTMLAttributes<HTMLDivElement> & {
    handle?: React.HTMLAttributes<HTMLDivElement>;
  };

export const VariationRow = forwardRef<HTMLDivElement, VariationProps>(
  (
    {
      i,
      variations,
      variation,
      handle,
      valueAsId,
      renumberKeysOnReorder = false,
      setVariations,
      valueType,
      hideVariationIds,
      hideValueField,
      valueWidth = null,
      onlySafeToEditVariationMetadata,
      customSplit,
      hideSplit,
      setWeight,
      feature,
      showDescription,
      showDragHandle,
      dragging,
      sparse,
      ...props
    },
    ref,
  ) => {
    const weights = variations.map((v) => v.weight);
    const weight = weights[i];
    const weightPercent = floatRound(weight * 100, 2);
    const [val, setVal] = useState<number>(weightPercent);
    useEffect(() => {
      if (val !== weightPercent) {
        setVal(weightPercent);
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [weightPercent]);

    const rebalanceAndUpdate = (
      i: number,
      newValue: number,
      precision: number = 4,
    ) => {
      if (!setWeight) return;
      rebalance(weights, i, newValue, precision).forEach((w, j) => {
        if (w !== weights[j]) {
          setWeight(j, w);
        }
      });
    };

    const valueIsKey = valueColumnIsKey({ valueAsId, hideVariationIds });
    const update = (patch: Partial<SortableVariation>) => {
      const newVariations = [...variations];
      newVariations[i] = { ...variation, ...patch };
      setVariations?.(newVariations);
    };

    const move = (to: number) =>
      setVariations?.(
        reorderVariations(variations, i, to, renumberKeysOnReorder),
      );

    return (
      <Box
        ref={ref}
        {...props}
        key={`${variation.id}__${i}`}
        px="2"
        py="3"
        style={{
          borderBottom:
            i < variations.length - 1 ? "1px solid var(--slate-4)" : undefined,
          opacity: dragging ? 0.5 : undefined,
          // The sortable transform arrives on props; keep it winning.
          ...props.style,
        }}
      >
        <Grid
          columns={gridColumns({
            hideVariationIds,
            hideValueField,
            valueWidth,
            showDescription,
            hideSplit,
            isJson: valueType === "json",
            showDragHandle,
          })}
          gapX="4"
          gapY="2"
          align="center"
        >
          {showDragHandle && (
            <Box
              {...handle}
              title="Drag and drop to re-order variations"
              style={{
                cursor: "grab",
                display: "flex",
                color: "var(--color-text-low)",
              }}
            >
              <RiDraggable size={16} />
            </Box>
          )}

          {!hideVariationIds && (
            <Flex justify="center">
              <VariationNumber number={i} />
            </Flex>
          )}

          {!hideValueField &&
            (setVariations && !onlySafeToEditVariationMetadata ? (
              valueIsKey ? (
                <Field
                  size="md"
                  id={`value_${i}`}
                  value={variation.value}
                  placeholder={valueAsId ? i + "" : ""}
                  onChange={(e) => update({ value: e.target.value })}
                />
              ) : (
                <div className={styles.tightValueCell}>
                  <FeatureValueField
                    size="md"
                    id={`value_${i}`}
                    value={variation.value}
                    placeholder={valueAsId ? i + "" : ""}
                    setValue={(value) => update({ value })}
                    valueType={valueType}
                    feature={feature}
                    renderJSONInline={false}
                    showFullscreenButton={true}
                    codeInputDefaultHeight={FIVE_LINES_HEIGHT}
                    sparse={sparse}
                  />
                </div>
              )
            ) : (
              <TruncatedText text={variation.value} />
            ))}

          {setVariations ? (
            <Field
              size="md"
              placeholder={`${getVariationDefaultName(
                variation,
                valueType ?? "string",
              )}`}
              value={variation.name || ""}
              onChange={(e) => update({ name: e.target.value })}
            />
          ) : (
            <TruncatedText text={variation.name || ""} />
          )}

          {showDescription &&
            (setVariations ? (
              <div>
                <Field
                  size="md"
                  value={variation.description || ""}
                  onChange={(e) => update({ description: e.target.value })}
                  textarea
                  minRows={1}
                />
              </div>
            ) : (
              <span>{variation.description || ""}</span>
            ))}

          {!hideSplit &&
            (customSplit ? (
              <Box position="relative" className={styles.percentInputWrapMd}>
                <Field
                  size="md"
                  id={`${variation.id}__${i}__3__input`}
                  value={val}
                  onChange={(e) =>
                    setVal(
                      parseFloat(
                        capTypedPercent(
                          e.target.value,
                          VARIATION_WEIGHT_DECIMALS,
                        ),
                      ),
                    )
                  }
                  onBlur={() => {
                    const decimal = floatRound(
                      (val >= 0 ? val : 0) / 100,
                      VARIATION_WEIGHT_DECIMALS + 2,
                    );
                    rebalanceAndUpdate(i, decimal);
                  }}
                  type="number"
                  min={0}
                  max={100}
                  step="any"
                  disabled={!setWeight}
                />
                <Text as="span">%</Text>
              </Box>
            ) : (
              <span>{decimalToPercent(weights[i])}%</span>
            ))}

          <Flex align="center" justify="end" gap="2">
            {setVariations && !onlySafeToEditVariationMetadata ? (
              <DropdownMenu
                trigger={
                  <MoreMenuTrigger
                    label="Variation actions"
                    style={{ margin: 0 }}
                  />
                }
                menuPlacement="end"
                variant="soft"
              >
                {/* Weights follow their variation, so a reorder never rebalances. */}
                <DropdownMenuItem
                  disabled={i === 0}
                  onClick={() => move(i - 1)}
                >
                  <PiCaretUp /> Move up
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={i === variations.length - 1}
                  onClick={() => move(i + 1)}
                >
                  <PiCaretDown /> Move down
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  disabled={variations.length <= 2}
                  color={variations.length > 2 ? "red" : undefined}
                  tooltip={
                    variations.length <= 2
                      ? "Experiments must have at least two variations"
                      : undefined
                  }
                  onClick={() => {
                    const newValues = [...variations];
                    newValues.splice(i, 1);

                    const newWeights = distributeWeights(
                      newValues.map((v) => v.weight),
                      customSplit,
                    );
                    newValues.forEach((v, j) => {
                      v.weight = newWeights[j] || 0;
                    });
                    setVariations(newValues);
                  }}
                >
                  Remove
                </DropdownMenuItem>
              </DropdownMenu>
            ) : null}
          </Flex>
        </Grid>
      </Box>
    );
  },
);

VariationRow.displayName = "VariationRow";

export function SortableFeatureVariationRow(props: SortableProps) {
  const { setNodeRef, style, isDragging, handle } = useSortableItem(
    props.variation.id,
  );

  return (
    <VariationRow
      {...props}
      ref={setNodeRef}
      style={style}
      dragging={isDragging}
      handle={handle}
    />
  );
}
