import React, { forwardRef } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { FaArrowsAlt } from "react-icons/fa";
import {
  ExperimentValue,
  FeatureInterface,
  FeatureValueType,
} from "@back-end/types/feature";
import clsx from "clsx";
import {
  decimalToPercent,
  distributeWeights,
  percentToDecimal,
  rebalance,
} from "@/services/utils";
import {
  getVariationColor,
  getVariationDefaultName,
} from "@/services/features";
import MoreMenu from "@/components/Dropdown/MoreMenu";
import Field from "@/components/Forms/Field";
import Tooltip from "@/components/Tooltip/Tooltip";
import FeatureValueField from "./FeatureValueField";
import styles from "./VariationsInput.module.scss";
import { CohortValidationWarning } from "./CohortValidation";

export type SortableVariation = ExperimentValue & {
  id: string;
};

interface SortableProps {
  i: number;
  variation: SortableVariation;
  variations: SortableVariation[];
  valueType: FeatureValueType;
  setVariations?: (value: ExperimentValue[]) => void;
  setWeight?: (i: number, weight: number) => void;
  customSplit: boolean;
  valueAsId: boolean;
  feature?: FeatureInterface;
  showCohortValidation?: boolean;
}

type VariationProps = SortableProps &
  React.HTMLAttributes<HTMLTableRowElement> & {
    handle?: React.HTMLAttributes<HTMLDivElement>;
  };

export const VariationRow = forwardRef<HTMLTableRowElement, VariationProps>(
  (
    {
      i,
      variations,
      variation,
      handle,
      valueAsId,
      setVariations,
      valueType,
      customSplit,
      setWeight,
      feature,
      showCohortValidation = false,
      ...props
    },
    ref
  ) => {
    const weights = variations.map((v) => v.weight);

    const rebalanceAndUpdate = (
      i: number,
      newValue: number,
      precision: number = 4
    ) => {
      if (!setWeight) return;
      rebalance(weights, i, newValue, precision).forEach((w, j) => {
        // The weight needs updating
        if (w !== weights[j]) {
          setWeight(j, w);
        }
      });
    };

    return (
      <tr ref={ref} {...props}>
        {!valueAsId && (
          <td style={{ width: 45 }} className="position-relative pl-3">
            <div
              className={styles.colorMarker}
              style={{
                backgroundColor: getVariationColor(i),
              }}
            />
            {i}
          </td>
        )}
        <td>
          {setVariations ? (
            <>
              {showCohortValidation && (
                <CohortValidationWarning value={variation.value} />
              )}
              <FeatureValueField
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
                label=""
                valueType={valueType}
                feature={feature}
                renderJSONInline={false}
              />
            </>
          ) : (
            <>{variation.value}</>
          )}
        </td>
        <td>
          {setVariations ? (
            <Field
              label=""
              placeholder={`${getVariationDefaultName(variation, valueType)}`}
              value={variation.name || ""}
              onChange={(e) => {
                const newVariations = [...variations];
                newVariations[i] = {
                  ...variation,
                  name: e.target.value,
                };
                setVariations(newVariations);
              }}
            />
          ) : (
            <strong>{variation.name || ""}</strong>
          )}
        </td>
        <td>
          <div className="row align-items-center">
            {customSplit ? (
              <div className="col d-flex flex-row">
                <input
                  value={decimalToPercent(weights[i] ?? 0)}
                  onChange={(e) => {
                    rebalanceAndUpdate(i, percentToDecimal(e.target.value));
                  }}
                  min="0"
                  max="100"
                  step="0.01"
                  type="range"
                  className="w-100 mr-3"
                  disabled={!setWeight}
                />
                <div className={`position-relative ${styles.percentInputWrap}`}>
                  <Field
                    value={decimalToPercent(weights[i] ?? 0)}
                    onChange={(e) => {
                      // the split now should add to 100% if there are two variations.
                      rebalanceAndUpdate(
                        i,
                        e.target.value === ""
                          ? 0
                          : percentToDecimal(e.target.value)
                      );
                      if (e.target.value === "") {
                        // I hate this, but not is also the easiest
                        setTimeout(() => {
                          e.target.focus();
                          e.target.select();
                        }, 100);
                      }
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
              </div>
            ) : (
              <div className="col d-flex flex-row">
                {decimalToPercent(weights[i])}%
              </div>
            )}
            {variations.length > 1 && setVariations && (
              <div {...handle} title="Drag and drop to re-order rules">
                <FaArrowsAlt />
              </div>
            )}
            {setVariations && (
              <div className="col-auto">
                <MoreMenu zIndex={1000000}>
                  <Tooltip
                    body="Experiments must have at least two variations"
                    shouldDisplay={variations.length <= 2}
                  >
                    <button
                      disabled={variations.length <= 2}
                      className={clsx(
                        "dropdown-item",
                        variations.length > 2 && "text-danger"
                      )}
                      onClick={(e) => {
                        e.preventDefault();

                        const newValues = [...variations];
                        newValues.splice(i, 1);

                        const newWeights = distributeWeights(
                          newValues.map((v) => v.weight),
                          customSplit
                        );

                        newValues.forEach((v, j) => {
                          v.weight = newWeights[j] || 0;
                        });
                        setVariations(newValues);
                      }}
                      type="button"
                    >
                      remove
                    </button>
                  </Tooltip>
                </MoreMenu>
              </div>
            )}
          </div>
        </td>
      </tr>
    );
  }
);

VariationRow.displayName = "VariationRow";

export function SortableFeatureVariationRow(props: SortableProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
  } = useSortable({ id: props.variation.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <VariationRow
      {...props}
      ref={setNodeRef}
      style={style}
      handle={{ ...attributes, ...listeners }}
    />
  );
}
