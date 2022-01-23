import { FC, Fragment } from "react";
import SRMWarning from "./SRMWarning";
import isEqual from "lodash/isEqual";
import {
  ExperimentReportResultDimension,
  ExperimentReportVariation,
} from "back-end/types/report";
import { useState } from "react";
import FixVariationIds from "./FixVariationIds";

const CommaList: FC<{ vals: string[] }> = ({ vals }) => {
  if (!vals.length) {
    return <em>empty</em>;
  }

  return (
    <>
      {vals.map((v, i) => (
        <Fragment key={v}>
          {i > 0 && ", "}
          <code>{v}</code>
        </Fragment>
      ))}
    </>
  );
};

const DataQualityWarning: FC<{
  results: ExperimentReportResultDimension;
  isUpdating?: boolean;
  variations: ExperimentReportVariation[];
  unknownVariations: string[];
  setVariationIds?: (ids: string[]) => Promise<void>;
}> = ({
  isUpdating,
  results,
  variations,
  unknownVariations,
  setVariationIds,
}) => {
  const [idModal, setIdModal] = useState(false);

  if (!results) return null;
  const variationResults = results?.variations || [];

  // Skip checks if experiment phase has extremely uneven weights
  // This causes too many false positives with the current data quality checks
  if (variations.filter((x) => x.weight < 0.02).length > 0) {
    return null;
  }

  // Minimum number of users required to do data quality checks
  let totalUsers = 0;
  variationResults.forEach((v) => {
    totalUsers += v.users;
  });
  if (totalUsers < 8 * variations.length && !unknownVariations?.length) {
    return null;
  }

  // Variations defined for the experiment
  const definedVariations: string[] = variations.map((v) => v.id).sort();
  // Variation ids returned from the query
  const returnedVariations: string[] = variationResults
    .map((v, i) => {
      return {
        variation: variations[i]?.id || i + "",
        hasData: v.users > 0,
      };
    })
    .filter((v) => v.hasData)
    .map((v) => v.variation)
    .concat(unknownVariations)
    .sort();

  // Problem was fixed
  if (
    unknownVariations?.length > 0 &&
    isEqual(returnedVariations, definedVariations)
  ) {
    if (isUpdating) {
      return null;
    }
    return (
      <div className="alert alert-info">
        Results are out of date. Update Data to refresh.
      </div>
    );
  }

  // There are unknown variations
  if (unknownVariations?.length > 0) {
    return (
      <>
        {idModal && (
          <FixVariationIds
            close={() => setIdModal(false)}
            expected={definedVariations}
            actual={returnedVariations}
            names={variations.map((v) => v.name)}
            setVariationIds={setVariationIds}
          />
        )}
        <div className="alert alert-warning">
          <strong>Warning:</strong> Expected {variations.length} variation ids (
          <CommaList vals={definedVariations} />
          ), but database returned{" "}
          {returnedVariations.length === definedVariations.length
            ? "a different set"
            : returnedVariations.length}{" "}
          (<CommaList vals={returnedVariations} />
          ).{" "}
          {setVariationIds && (
            <button
              className="btn btn-info btn-sm ml-3"
              type="button"
              onClick={(e) => {
                e.preventDefault();
                setIdModal(true);
              }}
            >
              Fix Ids
            </button>
          )}
        </div>
      </>
    );
  }

  // Results missing variations
  if (definedVariations.length > returnedVariations.length) {
    return (
      <div className="alert alert-warning">
        <strong>Warning</strong>: Missing data from the following variation ids:{" "}
        <CommaList
          vals={definedVariations.filter(
            (v) => !returnedVariations.includes(v)
          )}
        />
      </div>
    );
  }

  // SRM check
  return <SRMWarning srm={results.srm} />;
};
export default DataQualityWarning;
