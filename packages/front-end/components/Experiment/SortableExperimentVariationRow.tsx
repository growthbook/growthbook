import { forwardRef, useEffect, useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { FaArrowsAlt } from "react-icons/fa";
import {
  ExperimentValue,
  FeatureInterface,
  FeatureValueType,
} from "back-end/types/feature";
import clsx from "clsx";
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
import MoreMenu from "@/components/Dropdown/MoreMenu";
import Field from "@/components/Forms/Field";
import Tooltip from "@/components/Tooltip/Tooltip";
import styles from "@/components/Features/VariationsInput.module.scss";
import FeatureValueField from "@/components/Features/FeatureValueField";

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
}

type VariationProps = SortableProps &
  React.HTMLAttributes<HTMLTableRowElement> & {
    handle?: React.HTMLAttributes<HTMLDivElement>;
  };

export const ExperimentVariationRow = forwardRef<
  HTMLTableRowElement,
  VariationProps
>(
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

    return (
      <tr ref={ref} {...props} key={`${variation.id}__${i}`}>
        {!valueAsId && (
          <td
            style={{ width: 45 }}
            className="position-relative pl-3"
            key={`${variation.id}__${i}__0`}
          >
            <div
              className={styles.colorMarker}
              style={{
                backgroundColor: getVariationColor(i, true),
              }}
            />
            {i}
          </td>
        )}
        <td key={`${variation.id}__${i}__1`}>
          {setVariations ? (
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
              useCodeInput={true}
              showFullscreenButton={true}
            />
          ) : (
            <>{variation.value}</>
          )}
        </td>
        <td key={`${variation.id}__${i}__2`}>
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
        <td key={`${variation.id}__${i}__3`} style={{ width: 210 }}>
          <div className="row align-items-center">
            {customSplit ? (
              <div className="col d-flex flex-row">
                <div className={`position-relative ${styles.percentInputWrap}`}>
                  <Field
                    id={`${variation.id}__${i}__3__input`}
                    style={{ width: 95 }}
                    value={val}
                    onChange={(e) => {
                      setVal(parseFloat(e.target.value));
                    }}
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
                        variations.length > 2 && "text-danger",
                      )}
                      onClick={(e) => {
                        e.preventDefault();

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
  },
);

ExperimentVariationRow.displayName = "ExperimentVariationRow";

export function SortableExperimentVariationRow(props: SortableProps) {
  const { attributes, listeners, setNodeRef, transform, transition } =
    useSortable({ id: props.variation.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <ExperimentVariationRow
      {...props}
      ref={setNodeRef}
      style={style}
      handle={{ ...attributes, ...listeners }}
    />
  );
}
