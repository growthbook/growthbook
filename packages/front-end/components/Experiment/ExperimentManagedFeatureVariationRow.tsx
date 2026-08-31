import { ComponentProps, forwardRef, useEffect, useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { BsThreeDotsVertical } from "react-icons/bs";
import { RiDraggable } from "react-icons/ri";
import {
  PiCaretDown,
  PiCaretUp,
  PiInfo,
  PiPencilSimpleFill,
} from "react-icons/pi";
import { Box, Flex, Grid, IconButton } from "@radix-ui/themes";
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
import Tooltip from "@/ui/Tooltip";
import VariationNumber from "@/ui/VariationNumber";
import SelectField from "@/components/Forms/SelectField";
import { FIVE_LINES_HEIGHT } from "@/components/Forms/CodeTextArea";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/ui/DropdownMenu";
import FeatureValueField from "@/components/Features/FeatureValueField";
import Text from "@/ui/Text";
import rowStyles from "./ExperimentManagedFeatureVariationRow.module.scss";

// The one column template the header row and every variation row share.
export function gridColumns({
  hideValueField,
  showDescription,
  hideSplit,
  stackValue,
  hideFeatureValue,
  showDragHandle,
}: {
  hideValueField?: boolean;
  showDescription?: boolean;
  hideSplit?: boolean;
  // On its own row below, so it takes no column here.
  stackValue?: boolean;
  // There is no flag yet, so there is no value to show at all.
  hideFeatureValue?: boolean;
  // The reorder gutter, present only while the table is editable.
  showDragHandle?: boolean;
}): string {
  return [
    showDragHandle ? "16px" : undefined,
    "16px",
    hideValueField ? undefined : "minmax(80px, 0.4fr)",
    "minmax(160px, 1fr)",
    stackValue || hideFeatureValue ? undefined : "minmax(180px, 1.2fr)",
    showDescription ? "minmax(140px, 1fr)" : undefined,
    hideSplit ? undefined : "100px",
    // Wider than the row menu needs: the header's Advanced switch is absolutely
    // positioned in this column and would otherwise reach the Split label.
    "48px",
  ]
    .filter(Boolean)
    .join(" ");
}

export type ManagedSortableVariation = ExperimentValue & {
  id: string;
  description?: string;
  // The value served on the linked Feature Flag. Separate from `value`,
  // which stays the variation's own key.
  featureValue?: string;
};

interface SortableProps {
  i: number;
  variation: ManagedSortableVariation;
  variations: ManagedSortableVariation[];
  valueType?: FeatureValueType;
  hideValueField?: boolean;
  setVariations?: (value: ManagedSortableVariation[]) => void;
  setWeight?: (i: number, weight: number) => void;
  customSplit: boolean;
  hideSplit: boolean;
  valueAsId: boolean;
  feature?: FeatureInterface;
  // Scopes the "Insert constant" picker while the Feature Flag does not exist
  // yet (adoption creates it on save), the way the new-flag modal does.
  constantContext?: ComponentProps<typeof FeatureValueField>["constantContext"];
  showDescription?: boolean;
  // Render the value on its own row beneath the grid, whatever its type.
  stackValue?: boolean;
  hideFeatureValue?: boolean;
  // Names the served value; the editor's header uses the same string.
  valueLabel?: string;
  // Locks the served value until the caller opts into editing it.
  valueDisabled?: boolean;
  // Unlocks it. Rendered beside the stacked label, which repeats per row —
  // every copy drives the same caller state.
  onEditValues?: () => void;
  // Explains where an edit lands. null drops the info icon entirely.
  valueTooltip?: string | null;
  showDragHandle?: boolean;
  dragging?: boolean;
  autoFocusName?: boolean;
  // JSON features only. Renders the value as a sparse patch (merged onto the
  // feature default) in the value editor.
  sparse?: boolean;
}

type VariationProps = SortableProps &
  React.HTMLAttributes<HTMLDivElement> & {
    handle?: React.HTMLAttributes<HTMLDivElement>;
  };

export const ManagedVariationRow = forwardRef<HTMLDivElement, VariationProps>(
  (
    {
      i,
      variations,
      variation,
      handle,
      valueAsId,
      setVariations,
      valueType,
      hideValueField,
      customSplit,
      hideSplit,
      setWeight,
      feature,
      constantContext,
      showDescription,
      stackValue,
      hideFeatureValue,
      valueLabel = "Value",
      valueDisabled,
      onEditValues,
      valueTooltip,
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

    const setFeatureValue = (featureValue: string) => {
      if (!setVariations) return;
      const newVariations = [...variations];
      newVariations[i] = { ...variation, featureValue };
      setVariations(newVariations);
    };

    // Own picker rather than the shared field's, whose labels are upper case.
    // Width matches the number field in FeatureValueField: two fixed choices
    // shouldn't stretch across a stacked row.
    const booleanValueField = (label?: React.ReactNode) => (
      <Box style={{ width: 120 }}>
        <SelectField
          size="md"
          label={label}
          disabled={valueDisabled}
          value={variation.featureValue === "true" ? "true" : "false"}
          options={[
            { label: "True", value: "true" },
            { label: "False", value: "false" },
          ]}
          sort={false}
          onChange={setFeatureValue}
        />
      </Box>
    );

    const stackedValueLabel = (
      <Flex align="center" gap="1">
        {valueLabel}
        {valueTooltip ? (
          <Tooltip content={valueTooltip} side="top">
            <Flex align="center" style={{ color: "var(--color-text-low)" }}>
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
    );

    const isJson = valueType === "json";
    const stacked = stackValue ?? isJson;

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
            hideValueField,
            showDescription,
            hideSplit,
            stackValue: stacked,
            hideFeatureValue,
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

          <VariationNumber number={i} />

          {!hideValueField &&
            (setVariations ? (
              <Field
                size="md"
                id={`value_${i}`}
                value={variation.value}
                placeholder={valueAsId ? i + "" : ""}
                onChange={(e) => {
                  const newVariations = [...variations];
                  newVariations[i] = { ...variation, value: e.target.value };
                  setVariations(newVariations);
                }}
              />
            ) : (
              <span>{variation.value}</span>
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

          {/* Scalars sit in the row unless the layout stacks them below. */}
          {!stacked &&
            !hideFeatureValue &&
            (!setVariations ? (
              <span>{variation.featureValue ?? ""}</span>
            ) : valueType === "boolean" ? (
              booleanValueField()
            ) : (
              <div className={rowStyles.scalarValue}>
                <FeatureValueField
                  size="md"
                  id={`featureValue_${i}`}
                  value={variation.featureValue ?? ""}
                  setValue={setFeatureValue}
                  valueType={valueType}
                  feature={feature}
                  constantContext={constantContext}
                  disabled={valueDisabled}
                  renderJSONInline={false}
                  inlineConstantButton
                  sparse={sparse}
                />
              </div>
            ))}

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
              <Box position="relative" className={rowStyles.percentInputWrap}>
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
            {setVariations ? (
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

          {stacked && !hideFeatureValue && (
            <Box
              className={rowStyles.tightValueCell}
              style={{
                // Start after the id gutter, then run to the row's right edge:
                // the controls column has nothing to line up with on this row.
                gridColumn: `${(showDragHandle ? 1 : 0) + 2} / -1`,
              }}
            >
              {!setVariations ? (
                <span>{variation.featureValue ?? ""}</span>
              ) : valueType === "boolean" ? (
                booleanValueField(stackedValueLabel)
              ) : (
                <FeatureValueField
                  size="md"
                  label={stackedValueLabel}
                  id={`featureValue_${i}`}
                  value={variation.featureValue ?? ""}
                  setValue={setFeatureValue}
                  valueType={valueType}
                  feature={feature}
                  constantContext={constantContext}
                  disabled={valueDisabled}
                  renderJSONInline={false}
                  useCodeInput={isJson}
                  showFullscreenButton={isJson}
                  codeInputDefaultHeight={
                    isJson ? FIVE_LINES_HEIGHT : undefined
                  }
                  sparse={sparse}
                />
              )}
            </Box>
          )}
        </Grid>
      </Box>
    );
  },
);

ManagedVariationRow.displayName = "ManagedVariationRow";

export function SortableManagedVariationRow(props: SortableProps) {
  const { attributes, listeners, setNodeRef, transform, transition, active } =
    useSortable({ id: props.variation.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <ManagedVariationRow
      {...props}
      ref={setNodeRef}
      style={style}
      dragging={active?.id === props?.variation?.id}
      handle={{ ...attributes, ...listeners }}
    />
  );
}
