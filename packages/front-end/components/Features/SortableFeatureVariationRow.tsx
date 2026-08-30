import { forwardRef, useEffect, useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Box, Flex, Grid, IconButton } from "@radix-ui/themes";
import { BsThreeDotsVertical } from "react-icons/bs";
import { RiDraggable } from "react-icons/ri";
import { PiCaretDown, PiCaretUp } from "react-icons/pi";
import {
  ExperimentValue,
  FeatureInterface,
  FeatureValueType,
} from "shared/types/feature";
import {
  decimalToPercent,
  distributeWeights,
  floatRound,
  rebalance,
} from "@/services/utils";
import { getVariationDefaultName } from "@/services/features";
import Field from "@/components/Forms/Field";
import VariationNumber from "@/ui/VariationNumber";
import { FIVE_LINES_HEIGHT } from "@/components/Forms/CodeTextArea";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/ui/DropdownMenu";
import Text from "@/ui/Text";
import FeatureValueField from "./FeatureValueField";
import styles from "./VariationsInput.module.scss";

/** The one column template the header row and every variation row share. */
export function gridColumns({
  hideVariationIds,
  hideValueField,
  showDescription,
  hideSplit,
  isJson,
  showDragHandle,
}: {
  hideVariationIds?: boolean;
  hideValueField?: boolean;
  showDescription?: boolean;
  hideSplit?: boolean;
  // JSON values get a code editor in the cell, which needs the room.
  isJson?: boolean;
  // The reorder gutter, present only while the table is editable.
  showDragHandle?: boolean;
}): string {
  return [
    showDragHandle ? "16px" : undefined,
    hideVariationIds ? undefined : "16px",
    hideValueField
      ? undefined
      : isJson
        ? "minmax(300px, 2fr)"
        : "minmax(120px, 1fr)",
    "minmax(160px, 1fr)",
    showDescription ? "minmax(140px, 1fr)" : undefined,
    hideSplit ? undefined : "80px",
    "32px",
  ]
    .filter(Boolean)
    .join(" ");
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
  setVariations?: (value: ExperimentValue[]) => void;
  setWeight?: (i: number, weight: number) => void;
  customSplit: boolean;
  hideSplit: boolean;
  valueAsId: boolean;
  feature?: FeatureInterface;
  showDescription?: boolean;
  showDragHandle?: boolean;
  dragging?: boolean;
  onlySafeToEditVariationMetadata?: boolean;
  // Auto-focus this variation's Name field on mount.
  autoFocusName?: boolean;
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
      setVariations,
      valueType,
      hideVariationIds,
      hideValueField,
      onlySafeToEditVariationMetadata,
      customSplit,
      hideSplit,
      setWeight,
      feature,
      showDescription,
      showDragHandle,
      dragging,
      autoFocusName,
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
      if (val !== weight) {
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

    const isJson = valueType === "json";

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
            showDescription,
            hideSplit,
            isJson,
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

          {!hideVariationIds && <VariationNumber number={i} />}

          {!hideValueField &&
            (setVariations ? (
              <div className={styles.tightValueCell}>
                <FeatureValueField
                  size="md"
                  id={`value_${i}`}
                  value={variation.value}
                  placeholder={valueAsId ? i + "" : ""}
                  setValue={(value) => {
                    const newVariations = [...variations];
                    newVariations[i] = {
                      ...variation,
                      value,
                    };
                    setVariations(newVariations);
                  }}
                  valueType={valueType}
                  feature={feature}
                  renderJSONInline={false}
                  useCodeInput={true}
                  showFullscreenButton={true}
                  codeInputDefaultHeight={FIVE_LINES_HEIGHT}
                  sparse={sparse}
                />
              </div>
            ) : (
              <>{variation.value}</>
            ))}

          {setVariations ? (
            <Field
              size="md"
              autoFocus={autoFocusName}
              placeholder={`${getVariationDefaultName(
                variation,
                valueType ?? "string",
              )}`}
              value={variation.name || ""}
              onChange={(e) => {
                const newVariations = [...variations];
                newVariations[i] = { ...variation, name: e.target.value };
                setVariations(newVariations);
              }}
            />
          ) : (
            <strong>{variation.name || ""}</strong>
          )}

          {showDescription &&
            (setVariations ? (
              <div>
                <Field
                  size="md"
                  value={variation.description || ""}
                  onChange={(e) => {
                    const newVariations = [...variations];
                    newVariations[i] = {
                      ...variation,
                      description: e.target.value,
                    };
                    setVariations(newVariations);
                  }}
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
                  onChange={(e) => setVal(parseFloat(e.target.value))}
                  onBlur={() => {
                    const decimal = (val >= 0 ? val : 0) / 100;
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
                  <IconButton
                    variant="ghost"
                    color="gray"
                    radius="full"
                    size="2"
                    highContrast
                    style={{ margin: 0 }}
                  >
                    <BsThreeDotsVertical size={16} />
                  </IconButton>
                }
                menuPlacement="end"
                variant="soft"
              >
                {/* Weights follow their variation, so a reorder never rebalances. */}
                <DropdownMenuItem
                  disabled={i === 0}
                  onClick={() => {
                    const newValues = [...variations];
                    const [row] = newValues.splice(i, 1);
                    newValues.splice(i - 1, 0, row);
                    setVariations(newValues);
                  }}
                >
                  <PiCaretUp /> Move up
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={i === variations.length - 1}
                  onClick={() => {
                    const newValues = [...variations];
                    const [row] = newValues.splice(i, 1);
                    newValues.splice(i + 1, 0, row);
                    setVariations(newValues);
                  }}
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
  const { attributes, listeners, setNodeRef, transform, transition, active } =
    useSortable({ id: props.variation.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <VariationRow
      {...props}
      ref={setNodeRef}
      style={style}
      dragging={active?.id === props?.variation?.id}
      handle={{ ...attributes, ...listeners }}
    />
  );
}
