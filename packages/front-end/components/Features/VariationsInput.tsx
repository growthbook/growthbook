import { ExperimentValue, FeatureValueType } from "back-end/types/feature";
import React, { useState, useEffect } from "react";
import {
  DndContext,
  closestCenter,
  useSensor,
  useSensors,
  PointerSensor,
  KeyboardSensor,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import {
  decimalToPercent,
  distributeWeights,
  getEqualWeights,
  percentToDecimal,
} from "@/services/utils";
import { getDefaultVariationValue } from "@/services/features";
import { GBAddCircle } from "../Icons";
import Tooltip from "../Tooltip/Tooltip";
import ExperimentSplitVisual from "./ExperimentSplitVisual";
import styles from "./VariationsInput.module.scss";
import { SortableVariationRow } from "./Variation";

export interface Props {
  valueType: FeatureValueType;
  defaultValue?: string;
  variations: ExperimentValue[];
  setWeight: (i: number, weight: number) => void;
  setVariations?: (variations: ExperimentValue[]) => void;
  coverage: number;
  setCoverage: (coverage: number) => void;
  coverageTooltip?: string;
  valueAsId?: boolean;
  showPreview?: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  feature: any;
}

export default function VariationsInput({
  variations,
  setVariations,
  setWeight,
  coverage,
  setCoverage,
  valueType,
  defaultValue = "",
  coverageTooltip = "Users not included in the experiment will skip this rule.",
  valueAsId = false,
  showPreview = true,
}: Props) {
  const weights = variations.map((v) => v.weight);
  const isEqualWeights = weights.every((w) => w === weights[0]);
  const [customSplit, setCustomSplit] = useState(!isEqualWeights);
  const [items, setItems] = useState(() =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    variations.map((variation: any) => ({ ...variation, id: variation.name }))
  );

  useEffect(() => {
    setItems(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      variations.map((variation: any) => ({ ...variation, id: variation.name }))
    );
  }, [variations]);

  const setEqualWeights = () => {
    getEqualWeights(variations.length).forEach((w, i) => {
      setWeight(i, w);
    });
  };

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  function getVariationIndex(id: string) {
    for (let i = 0; i < items.length; i++) {
      if (items[i].id === id) return i;
    }
    return -1;
  }

  return (
    <div className="form-group">
      {setVariations ? (
        <label>Exposure, Variations and Weights</label>
      ) : (
        <label>Exposure and Weights</label>
      )}
      <div className="gbtable bg-light">
        <div className="p-3 pb-0 border-bottom">
          <label>
            Percent of traffic included in this experiment{" "}
            <Tooltip body={coverageTooltip} />
          </label>
          <div className="row align-items-center pb-3">
            <div className="col">
              <input
                value={isNaN(coverage) ? 0 : decimalToPercent(coverage)}
                onChange={(e) => {
                  let decimal = percentToDecimal(e.target.value);
                  if (decimal > 1) decimal = 1;
                  if (decimal < 0) decimal = 0;
                  setCoverage(decimal);
                }}
                min="0"
                max="100"
                step="1"
                type="range"
                className="w-100"
              />
            </div>
            <div
              className={`col-auto ${styles.percentInputWrap}`}
              style={{ fontSize: "1em" }}
            >
              <div className="form-group mb-0 position-relative">
                <input
                  className={`form-control ${styles.percentInput}`}
                  value={isNaN(coverage) ? "" : decimalToPercent(coverage)}
                  onChange={(e) => {
                    let decimal = percentToDecimal(e.target.value);
                    if (decimal > 1) decimal = 1;
                    if (decimal < 0) decimal = 0;
                    setCoverage(decimal);
                  }}
                  type="number"
                  min={0}
                  max={100}
                  step="1"
                />
                <span>%</span>
              </div>
            </div>
          </div>
        </div>
        <table className="table bg-light mb-0">
          <thead className={`${styles.variationSplitHeader}`}>
            <tr>
              <th className="pl-3">Id</th>
              {!valueAsId && <th>Variation</th>}
              <th>
                Name{" "}
                <Tooltip body="Optional way to identify the variations within GrowthBook." />
              </th>
              <th>
                Split
                <div className="d-inline-block float-right form-check form-check-inline">
                  <label className="mb-0">
                    <input
                      type="checkbox"
                      className="form-check-input position-relative"
                      checked={customSplit}
                      value={1}
                      onChange={(e) => {
                        setCustomSplit(e.target.checked);
                        if (!e.target.checked) {
                          setEqualWeights();
                        }
                      }}
                      id="checkbox-customsplits"
                      style={{ top: "2px" }}
                    />{" "}
                    Customize split
                  </label>
                </div>
              </th>
            </tr>
          </thead>
          <tbody>
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={({ active, over }) => {
                if (active.id !== over.id) {
                  const oldIndex = getVariationIndex(active.id);
                  const newIndex = getVariationIndex(over.id);

                  if (oldIndex === -1 || newIndex === -1) return;

                  const newVariations = arrayMove(
                    variations,
                    oldIndex,
                    newIndex
                  );

                  setVariations(newVariations);
                }
              }}
            >
              <SortableContext
                items={items}
                strategy={verticalListSortingStrategy}
              >
                {items.map(({ ...variation }, i) => (
                  <SortableVariationRow
                    i={i}
                    id={variation.id}
                    variation={variation}
                    variations={variations}
                    setVariations={setVariations}
                    setWeight={setWeight}
                    customSplit={customSplit}
                    key={variation.value}
                    valueType={valueType}
                  />
                ))}
              </SortableContext>
            </DndContext>
            <tr>
              <td colSpan={4}>
                <div className="row">
                  <div className="col">
                    {valueType !== "boolean" && setItems ? (
                      <a
                        className="btn btn-outline-primary"
                        href="#"
                        onClick={(e) => {
                          e.preventDefault();

                          const newWeights = distributeWeights(
                            [...weights, 0],
                            customSplit
                          );

                          // Add a new value and update weights
                          const newValues = [
                            ...variations,
                            {
                              value: getDefaultVariationValue(defaultValue),
                              name: "",
                              weight: 0,
                            },
                          ];
                          newValues.forEach((v, i) => {
                            v.weight = newWeights[i] || 0;
                          });
                          setVariations(newValues);
                        }}
                      >
                        <span
                          className={`h4 pr-2 m-0 d-inline-block align-top`}
                        >
                          <GBAddCircle />
                        </span>
                        add another variation
                      </a>
                    ) : (
                      <>
                        <Tooltip body="Boolean features can only have two variations. Use a different feature type to add multiple variations.">
                          <a className="btn btn-outline-primary disabled">
                            <span
                              className={`h4 pr-2 m-0 d-inline-block align-top`}
                            >
                              <GBAddCircle />
                            </span>
                            add another variation
                          </a>
                        </Tooltip>
                      </>
                    )}
                  </div>
                  {!isEqualWeights && (
                    <div className="col-auto text-right">
                      <a
                        href="#"
                        onClick={(e) => {
                          e.preventDefault();
                          setEqualWeights();
                        }}
                      >
                        set equal weights
                      </a>
                    </div>
                  )}
                </div>
              </td>
            </tr>

            {showPreview && (
              <tr>
                <td colSpan={4} className="pb-2">
                  <ExperimentSplitVisual
                    coverage={coverage}
                    values={variations}
                    type={valueType}
                  />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
