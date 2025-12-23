import clsx from "clsx";
import { useState } from "react";
import { Variation, VariationWithIndex } from "shared/types/experiment";
import Dropdown from "@/components/Dropdown/Dropdown";

export interface Props {
  variations: Variation[];
  variationFilter: number[];
  setVariationFilter: (variationFilter: number[]) => void;
  baselineRow: number;
  dropdownEnabled: boolean;
}

export default function VariationChooser({
  variations,
  variationFilter,
  setVariationFilter,
  baselineRow,
  dropdownEnabled,
}: Props) {
  const [open, setOpen] = useState(false);
  const indexedVariations = variations.map<VariationWithIndex>((v, i) => ({
    ...v,
    index: i,
  }));
  const validVariations = indexedVariations.filter(
    (v) => v.index !== baselineRow,
  );
  const filteredVariations = validVariations.filter(
    (v) => !variationFilter.includes(v.index),
  );
  const requiresDropdown = validVariations.length > 1 && dropdownEnabled;

  let title = (
    <div className="d-inline-block">
      <span className="hover">All variations</span>
    </div>
  );
  if (filteredVariations.length < validVariations.length) {
    title = (
      <div className="d-inline-block">
        <span className="hover">{filteredVariations.length} Variations</span>
      </div>
    );
  }
  if (filteredVariations.length <= 1) {
    title = (
      <div className="d-inline-flex align-items-center">
        <div
          className={`variation variation${
            filteredVariations[filteredVariations.length - 1]?.index
          } with-variation-label d-flex align-items-center`}
        >
          <span className="label" style={{ width: 20, height: 20 }}>
            {filteredVariations[filteredVariations.length - 1]?.index}
          </span>
          <span
            className="d-inline-block text-ellipsis hover"
            style={{ maxWidth: 150 }}
          >
            {filteredVariations[filteredVariations.length - 1]?.name}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="uppercase-title text-muted">Variations</div>
      <Dropdown
        uuid={"variation-filter"}
        right={false}
        className="mt-2"
        toggleClassName={clsx("d-inline-block", {
          "dropdown-underline": requiresDropdown,
          "dropdown-underline-disabled": !requiresDropdown,
        })}
        toggle={<div className="d-inline-flex align-items-center">{title}</div>}
        header={
          <>
            <div className="h6 mb-0">Show variations</div>
          </>
        }
        caret={requiresDropdown}
        enabled={requiresDropdown}
        open={open}
        setOpen={(b: boolean) => setOpen(b)}
      >
        {validVariations.length <= 1 ? null : (
          <div
            className={clsx(
              "d-flex align-items-center px-3 py-1 cursor-pointer",
              {
                "hover-highlight": variationFilter.length > 0,
              },
            )}
          >
            <div
              className="d-flex flex-1 align-items-center py-1"
              onClick={() => {
                setVariationFilter([]);
              }}
            >
              <div className="flex align-items-center justify-content-center px-1 mr-2">
                <input
                  readOnly
                  id={`variation-filter-checkbox-all`}
                  type="checkbox"
                  style={{
                    pointerEvents: "none",
                    verticalAlign: "-3px",
                    width: 16,
                    height: 16,
                    opacity: variationFilter.length > 0 ? 1 : 0.5,
                  }}
                  checked={variationFilter.length === 0}
                />
              </div>
              <div
                className={clsx("d-flex align-items-center", {
                  "text-muted": variationFilter.length === 0,
                })}
              >
                <em>select all</em>
              </div>
            </div>
          </div>
        )}

        {indexedVariations.map((variation) => {
          if (variation.index === baselineRow) return null;
          const canClick =
            filteredVariations.length > 1 ||
            !filteredVariations.map((v) => v.index).includes(variation.index);

          const toggleVariation = () => {
            if (!canClick) return;
            if (variationFilter.includes(variation.index)) {
              setVariationFilter(
                variationFilter.filter((v) => v !== variation.index),
              );
            } else {
              setVariationFilter([...variationFilter, variation.index].sort());
            }
          };

          const selectVariation = () => {
            setVariationFilter(
              validVariations
                .filter((v) => v.index !== variation.index)
                .map((v) => v.index),
            );
          };

          return (
            <div
              key={variation.id}
              className="d-flex align-items-center px-3 py-1 hover-highlight"
            >
              <div
                className="flex align-items-center justify-content-center cursor-pointer px-1 mr-2 py-1"
                onClick={toggleVariation}
              >
                <input
                  readOnly
                  id={`variation-filter-checkbox-${variation.index}`}
                  type="checkbox"
                  style={{
                    pointerEvents: "none",
                    verticalAlign: "-3px",
                    width: 16,
                    height: 16,
                    opacity: canClick ? 1 : 0.5,
                  }}
                  checked={!variationFilter.includes(variation.index)}
                />
              </div>
              <div
                className="d-flex align-items-center flex-1 cursor-pointer py-2"
                onClick={() => {
                  selectVariation();
                  setOpen(false);
                }}
              >
                <div
                  className={`variation variation${variation.index} with-variation-label d-flex align-items-center`}
                >
                  <span
                    className="label"
                    style={{ width: 20, height: 20, flex: "none" }}
                  >
                    {variation.index}
                  </span>
                  <span
                    className="d-inline-block"
                    style={{
                      width: 150,
                      lineHeight: "14px",
                    }}
                  >
                    {variation.name}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </Dropdown>
    </div>
  );
}
