import { FeatureInterface, FeatureValueType } from "back-end/types/feature";
import { Slider } from "@radix-ui/themes";
import React, { useState } from "react";
import { FaInfoCircle } from "react-icons/fa";
import { getEqualWeights } from "shared/experiments";
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
import { GBAddCircle } from "@/components/Icons";
import Tooltip from "@/components/Tooltip/Tooltip";
import Field from "@/components/Forms/Field";
import styles from "./VariationsInput.module.scss";
import ExperimentSplitVisual from "./ExperimentSplitVisual";
import {
  SortableFeatureVariationRow,
  SortableVariation,
} from "./SortableFeatureVariationRow";
import SortableVariationsList from "./SortableVariationsList";

export interface Props {
  valueType: FeatureValueType;
  defaultValue?: string;
  variations: SortableVariation[];
  setWeight: (i: number, weight: number) => void;
  setVariations?: (variations: SortableVariation[]) => void;
  coverage: number;
  setCoverage: (coverage: number) => void;
  coverageLabel?: string;
  coverageTooltip?: string;
  valueAsId?: boolean;
  showPreview?: boolean;
  hideCoverage?: boolean;
  disableCoverage?: boolean;
  disableVariations?: boolean;
  disableCustomSplit?: boolean;
  label?: string;
  customSplitOn?: boolean;
  feature?: FeatureInterface;
  hideVariations?: boolean;
  simple?: boolean;
}

export default function FeatureVariationsInput({
  variations,
  setVariations,
  setWeight,
  coverage,
  setCoverage,
  valueType,
  defaultValue = "",
  coverageLabel = "Traffic included in this Experiment",
  coverageTooltip = "Users not included in the Experiment will skip this rule",
  valueAsId = false,
  showPreview = true,
  hideCoverage = false,
  disableCoverage = false,
  disableVariations = false,
  disableCustomSplit = false,
  label: _label,
  customSplitOn,
  feature,
  hideVariations,
  simple,
}: Props) {
  const weights = variations.map((v) => v.weight);
  const isEqualWeights = weights.every((w) => w === weights[0]);
  const [customSplit, setCustomSplit] = useState(
    customSplitOn ?? !isEqualWeights
  );
  const [numberOfVariations, setNumberOfVariations] = useState(
    Math.max(variations?.length ?? 2, 2) + ""
  );

  const setEqualWeights = () => {
    getEqualWeights(variations.length).forEach((w, i) => {
      setWeight(i, w);
    });
  };

  const label = _label
    ? _label
    : simple
    ? "Traffic Percentage & Variations"
    : setVariations
    ? "Traffic Percentage, Variations, and Weights"
    : hideCoverage || hideVariations
    ? "Traffic Percentage"
    : "Traffic Percentage & Variation Weights";

  return (
    <div className="form-group">
      <label>{label}</label>
      {simple ? (
        <>
          {!hideCoverage && (
            <div className="px-3 pt-3 bg-highlight rounded mb-3">
              <label className="mb-0">
                {coverageLabel} <Tooltip body={coverageTooltip} />
              </label>
              <div className="row align-items-center pb-3 mx-1">
                <div className="col pl-0">
                  <Slider
                    value={isNaN(coverage) ? [0] : [decimalToPercent(coverage)]}
                    min={0}
                    max={100}
                    step={1}
                    disabled={!!disableCoverage}
                    onValueChange={(e) => {
                      let decimal = percentToDecimalForNumber(e[0]);
                      if (decimal > 1) decimal = 1;
                      if (decimal < 0) decimal = 0;
                      setCoverage(decimal);
                    }}
                  />
                </div>
                <div className="col-auto pr-0">
                  <div
                    className={`position-relative ${styles.percentInputWrap}`}
                  >
                    <Field
                      style={{ width: 95 }}
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
                      disabled={!!disableCoverage}
                    />
                    <span>%</span>
                  </div>
                </div>
              </div>
            </div>
          )}
          <Field
            label="Number of Variations"
            type="number"
            value={numberOfVariations}
            onChange={(e) => setNumberOfVariations(e?.target?.value ?? "2")}
            onBlur={(e) => {
              let n = parseInt(e?.target?.value ?? numberOfVariations);
              n = Math.min(Math.max(2, n), 100);
              const newValues: SortableVariation[] = [];
              for (let i = 0; i < n; i++) {
                newValues.push({
                  value: getDefaultVariationValue(defaultValue),
                  name: i === 0 ? "Control" : `Variation ${i}`,
                  weight: 1 / n,
                  id: generateVariationId(),
                });
              }
              setVariations?.(newValues);
              setNumberOfVariations(n + "");
            }}
          />
        </>
      ) : (
        <div className="gbtable">
          {!hideCoverage && (
            <div className="px-3 pt-3 bg-highlight rounded mb-3">
              <label className="mb-0">
                {coverageLabel} <Tooltip body={coverageTooltip} />
              </label>
              <div className="row align-items-center pb-3 mx-1">
                <div className="col pl-0">
                  <Slider
                    value={isNaN(coverage) ? [0] : [decimalToPercent(coverage)]}
                    min={0}
                    max={100}
                    step={1}
                    disabled={!!disableCoverage}
                    onValueChange={(e) => {
                      let decimal = percentToDecimalForNumber(e[0]);
                      if (decimal > 1) decimal = 1;
                      if (decimal < 0) decimal = 0;
                      setCoverage(decimal);
                    }}
                  />
                </div>
                <div className="col-auto pr-0">
                  <div
                    className={`position-relative ${styles.percentInputWrap}`}
                  >
                    <Field
                      style={{ width: 95 }}
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
                      disabled={!!disableCoverage}
                    />
                    <span>%</span>
                  </div>
                </div>
              </div>
            </div>
          )}
          {!hideVariations && (
            <table className="table mb-0">
              <thead className={`${styles.variationSplitHeader}`}>
                <tr>
                  <th className="pl-3">Id</th>
                  {!valueAsId && <th>Variation</th>}
                  <th>
                    <Tooltip
                      body="Optional way to identify the variations within GrowthBook."
                      tipPosition="top"
                    >
                      Name <FaInfoCircle />
                    </Tooltip>
                  </th>
                  <th>
                    Split
                    {!disableVariations && !disableCustomSplit && (
                      <div className="d-inline-block float-right form-check form-check-inline">
                        <label className="mb-0 cursor-pointer">
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
                    )}
                  </th>
                </tr>
              </thead>
              <tbody>
                <SortableVariationsList
                  variations={variations}
                  setVariations={!disableVariations ? setVariations : undefined}
                >
                  {variations.map((variation, i) => (
                    <SortableFeatureVariationRow
                      i={i}
                      key={variation.id}
                      variation={variation}
                      variations={variations}
                      setVariations={
                        !disableVariations ? setVariations : undefined
                      }
                      setWeight={!disableVariations ? setWeight : undefined}
                      customSplit={customSplit}
                      valueType={valueType}
                      valueAsId={valueAsId}
                      feature={feature}
                    />
                  ))}
                </SortableVariationsList>
                {!disableVariations && (
                  <tr>
                    <td colSpan={4}>
                      <div className="row">
                        <div className="col">
                          {valueType !== "boolean" && setVariations && (
                            <a
                              role="button"
                              className="btn btn-link p-0"
                              onClick={() => {
                                const newWeights = distributeWeights(
                                  [...weights, 0],
                                  customSplit
                                );

                                // Add a new value and update weights
                                const newValues = [
                                  ...variations,
                                  {
                                    value: getDefaultVariationValue(
                                      defaultValue
                                    ),
                                    name: "",
                                    weight: 0,
                                    id: generateVariationId(),
                                  },
                                ];
                                newValues.forEach((v, i) => {
                                  v.weight = newWeights[i] || 0;
                                });
                                setVariations(newValues);
                              }}
                            >
                              <GBAddCircle className="mr-2" />
                              Add variation
                            </a>
                          )}
                          {valueType === "boolean" && (
                            <>
                              <Tooltip body="Boolean features can only have two variations. Use a different feature type to add multiple variations.">
                                <a
                                  role="button"
                                  className="btn btn-link p-0 disabled"
                                >
                                  <GBAddCircle className="mr-2" />
                                  Add variation
                                </a>
                              </Tooltip>
                            </>
                          )}
                        </div>
                        {!isEqualWeights && !disableCustomSplit && (
                          <div className="col-auto text-right">
                            <a
                              role="button"
                              className="font-weight-bold link-purple"
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
                )}

                {showPreview && (
                  <tr>
                    <td colSpan={4} className="px-0 border-0">
                      <div className="box pt-3 px-3">
                        <ExperimentSplitVisual
                          coverage={coverage}
                          values={variations}
                          type={valueType}
                        />
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
