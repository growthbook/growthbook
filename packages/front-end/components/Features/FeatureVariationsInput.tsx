import { FeatureInterface, FeatureValueType } from "shared/types/feature";
import { Slider } from "@radix-ui/themes";
import React, { useState } from "react";
import { getEqualWeights } from "shared/experiments";
import { PiArrowsClockwise, PiLockSimpleFill } from "react-icons/pi";
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
import Link from "@/ui/Link";
import styles from "./VariationsInput.module.scss";
import ExperimentSplitVisual from "./ExperimentSplitVisual";
import {
  SortableFeatureVariationRow,
  SortableVariation,
} from "./SortableFeatureVariationRow";
import SortableVariationsList from "./SortableVariationsList";

export interface Props {
  valueType?: FeatureValueType;
  defaultValue?: string;
  variations?: SortableVariation[];
  setWeight?: (i: number, weight: number) => void;
  setVariations?: (variations: SortableVariation[]) => void;
  coverage?: number;
  setCoverage?: (coverage: number) => void;
  coverageLabel?: string;
  coverageTooltip?: string;
  valueAsId?: boolean;
  hideVariationIds?: boolean;
  hideValueField?: boolean;
  startEditingIndexes?: boolean;
  startEditingSplits?: boolean;
  showPreview?: boolean;
  hideCoverage?: boolean;
  disableCoverage?: boolean;
  disableVariations?: boolean;
  disableCustomSplit?: boolean;
  hideSplits?: boolean;
  label?: string | null;
  feature?: FeatureInterface;
  hideVariations?: boolean;
  showDescriptions?: boolean;
  simple?: boolean;
  sortableClassName?: string;
  onlySafeToEditVariationMetadata?: boolean;
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
  hideVariationIds = false,
  hideValueField = false,
  startEditingIndexes = false,
  startEditingSplits = false,
  showPreview = true,
  hideCoverage = false,
  disableCoverage = false,
  disableVariations = false,
  disableCustomSplit = false,
  hideSplits = false,
  label: _label,
  feature,
  hideVariations,
  showDescriptions,
  simple,
  sortableClassName,
  onlySafeToEditVariationMetadata,
}: Props) {
  const weights = variations?.map((v) => v.weight) || [];
  const isEqualWeights = weights?.every(
    (w) => Math.abs(w - weights[0]) < 0.0001,
  );

  const idsMatchIndexes = variations?.every((v, i) => v.value === i + "");

  const [editingSplits, setEditingSplits] = useState(startEditingSplits);
  const [editingIds, setEditingIds] = useState(
    startEditingIndexes || !idsMatchIndexes,
  );
  const [numberOfVariations, setNumberOfVariations] = useState(
    Math.max(variations?.length ?? 2, 2) + "",
  );

  const setEqualWeights = () => {
    if (!variations || !setWeight) return;
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
      {_label !== null ? <label>{label}</label> : null}
      {simple ? (
        <>
          {!hideCoverage ? (
            <div className="px-3 pt-3 bg-highlight rounded mb-3">
              <label className="mb-0">
                {coverageLabel} <Tooltip body={coverageTooltip} />
              </label>
              <div className="row align-items-center pb-3 mx-1">
                <div className="col pl-0">
                  <Slider
                    value={
                      isNaN(coverage ?? 0)
                        ? [0]
                        : [decimalToPercent(coverage ?? 0)]
                    }
                    min={0}
                    max={100}
                    step={1}
                    disabled={!!disableCoverage}
                    onValueChange={(e) => {
                      let decimal = percentToDecimalForNumber(e[0]);
                      if (decimal > 1) decimal = 1;
                      if (decimal < 0) decimal = 0;
                      setCoverage?.(decimal);
                    }}
                  />
                </div>
                <div className="col-auto pr-0">
                  <div
                    className={`position-relative ${styles.percentInputWrap}`}
                  >
                    <Field
                      style={{ width: 95 }}
                      value={
                        isNaN(coverage ?? 0)
                          ? ""
                          : decimalToPercent(coverage ?? 0)
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
                      disabled={!!disableCoverage}
                    />
                    <span>%</span>
                  </div>
                </div>
              </div>
            </div>
          ) : null}
          <Field
            label="Number of Variations"
            type="number"
            value={numberOfVariations}
            disabled={onlySafeToEditVariationMetadata}
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
        <>
          {!hideCoverage ? (
            <div className="px-3 pt-3 bg-highlight rounded mb-3">
              <label className="mb-0">
                {coverageLabel} <Tooltip body={coverageTooltip} />
              </label>
              <div className="row align-items-center pb-3 mx-1">
                <div className="col pl-0">
                  <Slider
                    value={
                      isNaN(coverage ?? 0)
                        ? [0]
                        : [decimalToPercent(coverage ?? 0)]
                    }
                    min={0}
                    max={100}
                    step={1}
                    disabled={!!disableCoverage}
                    onValueChange={(e) => {
                      let decimal = percentToDecimalForNumber(e[0]);
                      if (decimal > 1) decimal = 1;
                      if (decimal < 0) decimal = 0;
                      setCoverage?.(decimal);
                    }}
                  />
                </div>
                <div className="col-auto pr-0">
                  <div
                    className={`position-relative ${styles.percentInputWrap}`}
                  >
                    <Field
                      style={{ width: 95 }}
                      value={
                        isNaN(coverage ?? 0)
                          ? ""
                          : decimalToPercent(coverage ?? 0)
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
                      disabled={
                        !!disableCoverage && onlySafeToEditVariationMetadata
                      }
                    />
                    <span>%</span>
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {!hideVariationIds &&
            !startEditingIndexes &&
            !valueAsId &&
            !hideValueField && (
              <div className="mb-2">
                {!editingIds ? (
                  <Link
                    onClick={() => {
                      setEditingIds(true);
                    }}
                  >
                    Switch to advanced mode
                  </Link>
                ) : (
                  <span className="text-muted">Advanced mode</span>
                )}
              </div>
            )}

          {!hideVariations && (
            <table className="table table-borderless mb-0">
              <thead className={styles.thead}>
                <tr>
                  {!hideVariationIds && (
                    <th className="pl-3 pr-0">
                      {!valueAsId && !hideValueField && editingIds ? "#" : "Id"}
                    </th>
                  )}
                  {!hideVariationIds && !hideValueField && editingIds && (
                    <th>Id</th>
                  )}
                  {hideVariationIds && !valueAsId && <th>Value to Force</th>}
                  <th>Variation Name</th>
                  {showDescriptions && <th>Description</th>}
                  {!hideSplits && (
                    <th>
                      Split
                      {!disableVariations &&
                        !disableCustomSplit &&
                        !editingSplits &&
                        !onlySafeToEditVariationMetadata && (
                          <Tooltip
                            body="Customize split"
                            usePortal={true}
                            tipPosition="top"
                          >
                            <a
                              role="button"
                              className="ml-1 mb-0"
                              onClick={() => {
                                setEditingSplits(true);
                              }}
                            >
                              <PiLockSimpleFill
                                className="text-purple"
                                size={15}
                              />
                            </a>
                          </Tooltip>
                        )}
                      {editingSplits &&
                        !isEqualWeights &&
                        !disableCustomSplit &&
                        !hideSplits && (
                          <Tooltip
                            body="Assign equal weights to all variations"
                            usePortal={true}
                            tipPosition="top"
                          >
                            <a
                              role="button"
                              className="ml-2 link-purple small"
                              onClick={(e) => {
                                e.preventDefault();
                                setEqualWeights();
                              }}
                            >
                              <PiArrowsClockwise className="mr-1" size={12} />
                              set equal
                            </a>
                          </Tooltip>
                        )}
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {variations && (
                  <SortableVariationsList
                    valuesAsIds={idsMatchIndexes}
                    variations={variations}
                    setVariations={
                      !disableVariations ? setVariations : undefined
                    }
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
                        onlySafeToEditVariationMetadata={
                          onlySafeToEditVariationMetadata
                        }
                        customSplit={editingSplits}
                        valueType={valueType}
                        valueAsId={valueAsId}
                        hideVariationIds={hideVariationIds}
                        hideValueField={hideValueField || !editingIds}
                        hideSplit={hideSplits}
                        feature={feature}
                        showDescription={showDescriptions}
                        className={sortableClassName}
                      />
                    ))}
                  </SortableVariationsList>
                )}
              </tbody>
              <tfoot>
                {!disableVariations &&
                  variations &&
                  setWeight &&
                  !onlySafeToEditVariationMetadata && (
                    <tr>
                      <td colSpan={10}>
                        <div className="row">
                          <div className="col">
                            {valueType !== "boolean" && setVariations && (
                              <a
                                role="button"
                                className="btn btn-link link-purple font-weight-bold p-0"
                                onClick={() => {
                                  const newWeights = distributeWeights(
                                    [...weights, 0],
                                    editingSplits,
                                  );

                                  // Add a new value and update weights
                                  const newValues = [
                                    ...variations,
                                    {
                                      value:
                                        getDefaultVariationValue(defaultValue),
                                      name: `Variation ${variations.length}`,
                                      weight: 0,
                                      id: generateVariationId(),
                                    },
                                  ];
                                  newValues.forEach((v, i) => {
                                    v.weight = newWeights[i] || 0;
                                  });
                                  setVariations(newValues);
                                  if (isEqualWeights) {
                                    getEqualWeights(newValues.length).forEach(
                                      (w, i) => setWeight(i, w),
                                    );
                                  }
                                }}
                              >
                                <GBAddCircle className="mr-1" />
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
                        </div>
                      </td>
                    </tr>
                  )}

                {showPreview && coverage !== undefined && variations ? (
                  <tr>
                    <td colSpan={10} className="px-0 border-0">
                      <div className="box pt-3 px-3">
                        <ExperimentSplitVisual
                          coverage={coverage}
                          values={variations}
                          type={valueType ?? "string"}
                        />
                      </div>
                    </td>
                  </tr>
                ) : null}
              </tfoot>
            </table>
          )}
        </>
      )}
    </div>
  );
}
