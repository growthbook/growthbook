import { FC, Fragment } from "react";
import {
  ExperimentInterfaceStringDates,
  ExperimentPhaseStringDates,
} from "back-end/types/experiment";
import { ExperimentSnapshotInterface } from "back-end/types/experiment-snapshot";
import SRMWarning from "./SRMWarning";
import isEqual from "lodash/isEqual";

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
  experiment: ExperimentInterfaceStringDates;
  snapshot: ExperimentSnapshotInterface;
  phase?: ExperimentPhaseStringDates;
  isUpdating?: boolean;
}> = ({ experiment, snapshot, phase, isUpdating }) => {
  if (!snapshot || !phase) return null;
  const results = snapshot.results[0];
  if (!results) return null;
  const variations = results?.variations || [];

  // Skip checks if experiment phase has extremely uneven weights
  // This causes too many false positives with the current data quality checks
  if (phase.variationWeights.filter((x) => x < 0.02).length > 0) {
    return null;
  }

  // Minimum number of users required to do data quality checks
  let totalUsers = 0;
  variations.forEach((v) => {
    totalUsers += v.users;
  });
  if (
    totalUsers < 8 * experiment.variations.length &&
    !snapshot.unknownVariations?.length
  ) {
    return null;
  }

  // Variations defined for the experiment
  const definedVariations: string[] = experiment.variations
    .map((v, i) => v.key || i + "")
    .sort();
  // Variation ids returned from the query
  const returnedVariations: string[] = variations
    .map((v, i) => {
      return {
        variation: experiment.variations[i]?.key || i + "",
        hasData: v.users > 0,
      };
    })
    .filter((v) => v.hasData)
    .map((v) => v.variation)
    .concat(snapshot.unknownVariations || [])
    .sort();

  // Problem was fixed
  if (
    snapshot.unknownVariations?.length > 0 &&
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
  if (snapshot.unknownVariations?.length > 0) {
    return (
      <div className="alert alert-warning">
        <strong>Warning:</strong> Expected {experiment.variations.length}{" "}
        variation ids (<CommaList vals={definedVariations} />
        ), but database returned{" "}
        {returnedVariations.length === definedVariations.length
          ? "a different set"
          : returnedVariations.length}{" "}
        (<CommaList vals={returnedVariations} />
        ).
      </div>
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
