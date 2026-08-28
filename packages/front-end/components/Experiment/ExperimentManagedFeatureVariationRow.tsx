import { forwardRef, useEffect, useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { BsThreeDotsVertical } from "react-icons/bs";
import { FaArrowsAlt } from "react-icons/fa";
import { PiCaretDown, PiCaretUp } from "react-icons/pi";
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
import {
  getVariationColor,
  getVariationDefaultName,
} from "@/services/features";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import { FIVE_LINES_HEIGHT } from "@/components/Forms/CodeTextArea";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/ui/DropdownMenu";
import FeatureValueField from "@/components/Features/FeatureValueField";
import styles from "@/components/Features/VariationsInput.module.scss";
import rowStyles from "./ExperimentManagedFeatureVariationRow.module.scss";

/** The one column template the header row and every variation row share. */
export function gridColumns({
  hideVariationIds,
  hideValueField,
  showDescription,
  hideSplit,
  isJson,
}: {
  hideVariationIds?: boolean;
  hideValueField?: boolean;
  showDescription?: boolean;
  hideSplit?: boolean;
  isJson?: boolean;
}): string {
  return [
    hideVariationIds ? undefined : "56px",
    hideValueField ? undefined : "minmax(120px, 1fr)",
    "minmax(160px, 1fr)",
    isJson ? undefined : "minmax(180px, 1.2fr)",
    showDescription ? "minmax(140px, 1fr)" : undefined,
    hideSplit ? undefined : "68px",
    "84px",
  ]
    .filter(Boolean)
    .join(" ");
}

export type ManagedSortableVariation = ExperimentValue & {
  id: string;
  description?: string;
  /**
   * The value this variation serves on the experiment's managed Feature Flag.
   * Separate from `value`, which stays the variation's own key.
   */
  featureValue?: string;
};

interface SortableProps {
  i: number;
  variation: ManagedSortableVariation;
  variations: ManagedSortableVariation[];
  valueType?: FeatureValueType;
  hideVariationIds?: boolean;
  hideValueField?: boolean;
  setVariations?: (value: ManagedSortableVariation[]) => void;
  setWeight?: (i: number, weight: number) => void;
  customSplit: boolean;
  hideSplit: boolean;
  valueAsId: boolean;
  feature?: FeatureInterface;
  showDescription?: boolean;
  dragging?: boolean;
  className?: string;
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
      hideVariationIds,
      hideValueField,
      onlySafeToEditVariationMetadata,
      customSplit,
      hideSplit,
      setWeight,
      feature,
      showDescription,
      dragging,
      className = "",
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
        // The weight needs updating
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
        className={className}
        px="2"
        py="2"
        style={{
          // A rule between rows rather than a box around each — this reads as a
          // table, and a boxed row per variation was too heavy.
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
          })}
          gap="4"
          align="center"
        >
          {!hideVariationIds && (
            <Flex align="center" gap="2" minWidth="0">
              {/* A fixed swatch: the shared .colorMarker is absolutely
                  positioned for a table cell and stretches out of a grid. */}
              <Box
                style={{
                  width: 4,
                  height: 24,
                  borderRadius: 2,
                  flexShrink: 0,
                  backgroundColor: getVariationColor(i, true),
                }}
              />
              <span>{i}</span>
            </Flex>
          )}

          {!hideValueField && (
            <FeatureValueField
              size="md"
              id={`value_${i}`}
              value={variation.value}
              placeholder={valueAsId ? i + "" : ""}
              setValue={(value) => {
                const newVariations = [...variations];
                newVariations[i] = { ...variation, value };
                setVariations?.(newVariations);
              }}
              valueType={valueType}
              feature={feature}
              renderJSONInline={false}
              useCodeInput={true}
              showFullscreenButton={true}
              codeInputDefaultHeight={FIVE_LINES_HEIGHT}
              sparse={sparse}
            />
          )}

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

          {/* Scalars sit in the row; JSON gets its own full-width line below. */}
          {!isJson &&
            (!setVariations ? (
              <span>{variation.featureValue ?? ""}</span>
            ) : valueType === "boolean" ? (
              // A choice, not free text. Own picker rather than the shared
              // field's, whose labels are upper case.
              <SelectField
                // 32px, matching `Field size="md"`. SelectField's own "medium"
                // is 40px — the two components' size names do not line up.
                size="small"
                value={variation.featureValue === "true" ? "true" : "false"}
                options={[
                  { label: "True", value: "true" },
                  { label: "False", value: "false" },
                ]}
                sort={false}
                onChange={(featureValue) => {
                  const newVariations = [...variations];
                  newVariations[i] = { ...variation, featureValue };
                  setVariations(newVariations);
                }}
              />
            ) : (
              <div className={rowStyles.scalarValue}>
                <FeatureValueField
                  size="md"
                  id={`featureValue_${i}`}
                  value={variation.featureValue ?? ""}
                  setValue={(featureValue) => {
                    const newVariations = [...variations];
                    newVariations[i] = { ...variation, featureValue };
                    setVariations(newVariations);
                  }}
                  valueType={valueType}
                  feature={feature}
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
              <div className={`position-relative ${styles.percentInputWrap}`}>
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
                  className={styles.percentInput}
                  disabled={!setWeight}
                />
                <span>%</span>
              </div>
            ) : (
              <span>{decimalToPercent(weights[i])}%</span>
            ))}

          <Flex align="center" justify="end" gap="1">
            {variations.length > 1 &&
              setVariations &&
              !onlySafeToEditVariationMetadata && (
                <div
                  {...handle}
                  title="Drag and drop to re-order variations"
                  style={{ cursor: "grab", display: "flex" }}
                >
                  <FaArrowsAlt />
                </div>
              )}
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

        {isJson && (
          <Box mt="2">
            {setVariations ? (
              <FeatureValueField
                size="md"
                id={`featureValue_${i}`}
                value={variation.featureValue ?? ""}
                setValue={(featureValue) => {
                  const newVariations = [...variations];
                  newVariations[i] = { ...variation, featureValue };
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
            ) : (
              <span>{variation.featureValue ?? ""}</span>
            )}
          </Box>
        )}
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
