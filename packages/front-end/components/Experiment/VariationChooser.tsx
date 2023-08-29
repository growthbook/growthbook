import {
  ExperimentReportVariation,
  ExperimentReportVariationWithIndex,
} from "back-end/types/report";
import clsx from "clsx";
import Dropdown from "@/components/Dropdown/Dropdown";
import DropdownLink from "@/components/Dropdown/DropdownLink";

export interface Props {
  variations: ExperimentReportVariation[];
  variationFilter: number[];
  setVariationFilter: (variationFilter: number[]) => void;
  baselineRow: number;
}

export default function VariationChooser({
  variations,
  variationFilter,
  setVariationFilter,
  baselineRow,
}: Props) {
  const filteredVariations = variations
    .map<ExperimentReportVariationWithIndex>((v, i) => ({ ...v, index: i }))
    .filter((_, i) => !variationFilter.includes(i));
  const showDropdown = variations.length > 2;
  let title = (
    <div
      className={clsx("d-inline-block btn-link", { "btn-link": showDropdown })}
    >
      <span className="font-weight-bold ">All variations</span> (
      {variations.length - 1})
    </div>
  );
  if (filteredVariations.length <= variations.length - 1) {
    title = (
      <div
        className={clsx("d-inline-block btn-link", {
          "btn-link": showDropdown,
        })}
      >
        <span className="font-weight-bold">
          {filteredVariations.length - 1} Variations
        </span>{" "}
        ({variations.length - 1} total)
      </div>
    );
  }
  if (filteredVariations.length <= 2) {
    title = (
      <div
        className={clsx("d-inline-flex align-items-center", {
          "variation-chooser-hover-underline": showDropdown,
        })}
      >
        <div
          className={`variation variation${
            filteredVariations[filteredVariations.length - 1].index
          } with-variation-label d-flex align-items-center`}
        >
          <span
            className="label skip-underline"
            style={{ width: 20, height: 20 }}
          >
            {filteredVariations[filteredVariations.length - 1].index}
          </span>
          <span
            className="d-inline-block text-ellipsis font-weight-bold"
            style={{
              maxWidth: 200,
            }}
          >
            {filteredVariations[filteredVariations.length - 1].name}
          </span>
        </div>
      </div>
    );
  }
  return (
    <>
      <Dropdown
        uuid={"variation-filter"}
        right={false}
        className="border"
        toggle={
          <div
            className="d-inline-flex align-items-center"
            style={{ height: 38 }}
          >
            {title}
          </div>
        }
        caret={showDropdown}
        open={showDropdown}
        setOpen={showDropdown ? undefined : (o) => o}
      >
        {variations.map((variation, i) => {
          if (i === baselineRow) return null;
          return (
            <DropdownLink
              key={variation.id}
              className="py-2"
              closeOnClick={false}
              onClick={() => {
                // add or remove variation from filter
                if (variationFilter.includes(i)) {
                  setVariationFilter(variationFilter.filter((v) => v !== i));
                } else {
                  const newFilter = [...variationFilter, i];
                  if (newFilter.length >= variations.length - 1) {
                    return;
                  }
                  setVariationFilter(newFilter);
                }
              }}
            >
              <div className={`d-flex align-items-center`}>
                <div className="mr-2">
                  <input
                    readOnly
                    type="checkbox"
                    style={{ pointerEvents: "none", verticalAlign: "-1px" }}
                    checked={!variationFilter.includes(i)}
                  />
                </div>
                <div className="d-flex align-items-center">
                  <div className="mr-2">
                    <div
                      className={`variation variation${i} with-variation-label d-flex align-items-center`}
                    >
                      <span className="label" style={{ width: 16, height: 16 }}>
                        {i}
                      </span>
                      <span
                        className="d-inline-block text-ellipsis font-weight-bold"
                        style={{
                          maxWidth: 200,
                        }}
                      >
                        {variations[i].name}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </DropdownLink>
          );
        })}
      </Dropdown>
    </>
  );
}
