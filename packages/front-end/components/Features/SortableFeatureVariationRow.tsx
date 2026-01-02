import { forwardRef, useEffect, useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { FaArrowsAlt } from "react-icons/fa";
import {
  ExperimentValue,
  FeatureInterface,
  FeatureValueType,
} from "shared/types/feature";
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
import { FIVE_LINES_HEIGHT } from "@/components/Forms/CodeTextArea";
import Tooltip from "@/components/Tooltip/Tooltip";
import FeatureValueField from "./FeatureValueField";
import styles from "./VariationsInput.module.scss";

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
  dragging?: boolean;
  className?: string;
  onlySafeToEditVariationMetadata?: boolean;
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
      <tr
        ref={ref}
        {...props}
        key={`${variation.id}__${i}`}
        className={`${className} ${styles.tr} ${dragging && styles.dragging}`}
      >
        {!hideVariationIds && (
          <td
            style={{ width: 45 }}
            className="position-relative pl-3 pr-0"
            key={`${variation.id}__${i}__0`}
          >
            <div
              className={styles.colorMarker}
              style={{
                backgroundColor: getVariationColor(i, true),
              }}
            />
            <span style={{ position: "relative", top: 6 }}>{i}</span>
          </td>
        )}
        {!hideValueField && (
          <td
            key={`${variation.id}__${i}__1`}
            style={valueType === "json" ? { minWidth: 300 } : undefined}
          >
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
                valueType={valueType}
                feature={feature}
                renderJSONInline={false}
                useCodeInput={true}
                showFullscreenButton={true}
                codeInputDefaultHeight={FIVE_LINES_HEIGHT}
              />
            ) : (
              <>{variation.value}</>
            )}
          </td>
        )}
        <td key={`${variation.id}__${i}__2`}>
          {setVariations ? (
            <Field
              placeholder={`${getVariationDefaultName(
                variation,
                valueType ?? "string",
              )}`}
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
            <strong style={{ position: "relative", top: 6 }}>
              {variation.name || ""}
            </strong>
          )}
        </td>
        {showDescription && (
          <td key={`${variation.id}__${i}__3`}>
            {setVariations ? (
              <Field
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
            ) : (
              <span style={{ position: "relative", top: 6 }}>
                {variation.description || ""}
              </span>
            )}
          </td>
        )}
        <td
          key={`${variation.id}__${i}__4`}
          style={{ width: !hideSplit ? 180 : 60 }}
        >
          <div className="row align-items-center">
            {!hideSplit && (
              <>
                {customSplit ? (
                  <div className="col d-flex flex-row">
                    <div
                      className={`position-relative ${styles.percentInputWrap}`}
                    >
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
                    <span style={{ position: "relative", top: 6 }}>
                      {decimalToPercent(weights[i])}%
                    </span>
                  </div>
                )}
              </>
            )}
            {variations.length > 1 &&
              setVariations &&
              !onlySafeToEditVariationMetadata && (
                <div {...handle} title="Drag and drop to re-order rules">
                  <FaArrowsAlt style={{ position: "relative", top: 4 }} />
                </div>
              )}
            {setVariations && !onlySafeToEditVariationMetadata && (
              <div
                className="col-auto"
                style={{ position: "relative", top: 4 }}
              >
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
                      Remove
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

VariationRow.displayName = "VariationRow";

export function SortableFeatureVariationRow(props: SortableProps) {
  const { attributes, listeners, setNodeRef, transform, transition, active } =
    useSortable({ id: props.variation.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    border: "1px solid red !important",
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
