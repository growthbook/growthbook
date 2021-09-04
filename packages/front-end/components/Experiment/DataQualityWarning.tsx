import { FC } from "react";
import {
  ExperimentInterfaceStringDates,
  ExperimentPhaseStringDates,
} from "back-end/types/experiment";
import { ExperimentSnapshotInterface } from "back-end/types/experiment-snapshot";
import SRMWarning from "./SRMWarning";
import isEqual from "lodash/isEqual";
import { useDefinitions } from "../../services/DefinitionsContext";

const DataQualityWarning: FC<{
  experiment: ExperimentInterfaceStringDates;
  snapshot: ExperimentSnapshotInterface;
  phase?: ExperimentPhaseStringDates;
}> = ({ experiment, snapshot, phase }) => {
  const { getDatasourceById } = useDefinitions();

  if (!snapshot || !phase) return null;
  const results = snapshot.results[0];
  if (!results) return null;
  const variations = results?.variations || [];

  // Skip checks if experiment phase has extremely uneven weights
  // This causes too many false positives with the current data quality checks
  if (phase.variationWeights.filter((x) => x < 0.02).length > 0) {
    return;
  }

  const datasource = getDatasourceById(experiment.datasource);
  const hasStringKeys = datasource?.settings?.variationIdFormat === "key";

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
    return (
      <div className="alert alert-info">
        Results are out of date. Update Data to refresh.
      </div>
    );
  }

  // There are unknown variations
  if (snapshot.unknownVariations?.length > 0) {
    // Data source is expecting numeric variation ids, but received string ids
    if (
      !hasStringKeys &&
      snapshot.unknownVariations.filter((x) => isNaN(parseInt(x))).length > 0
    ) {
      return (
        <div className="alert alert-danger">
          <div className="mb-2">
            Your data source is configured to expect variation ids as numeric
            indexes (e.g. <code>0</code>, <code>1</code>, etc.), but we received
            strings instead (
            {snapshot.unknownVariations.map((v) => (
              <code key={v} className="mx-2">
                {v}
              </code>
            ))}
            ).
          </div>
          Please check your data source settings.
        </div>
      );
    }

    // Data source returned incorrect set of numeric ids
    if (!hasStringKeys) {
      return (
        <div className="alert alert-warning">
          <strong>Warning:</strong> Expected {experiment.variations.length}{" "}
          variation ids (<code>{definedVariations.join(",")}</code>), but
          database returned{" "}
          {returnedVariations.length === definedVariations.length
            ? "a different set"
            : returnedVariations.length}{" "}
          (<code>{returnedVariations.join(",")}</code>).
        </div>
      );
    }

    // Data source using string keys and has unexpected variations returned
    return (
      <div className="alert alert-danger">
        <h4 className="font-weight-bold">Unexpected Variation Ids</h4>
        <div>
          <div className="mb-1">
            Ids returned from data source:
            {returnedVariations.map((v) => (
              <code className="mx-2" key={v}>
                {v}
              </code>
            ))}
          </div>
          <div>
            Ids defined in GrowthBook:
            {definedVariations.map((v) => (
              <code className="mx-2" key={v}>
                {v}
              </code>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // Results missing variations
  if (definedVariations.length > returnedVariations.length) {
    return (
      <div className="alert alert-warning">
        <strong>Warning</strong>: Missing data from one or more variations.
      </div>
    );
  }

  // SRM check
  return <SRMWarning srm={results.srm} />;
};
export default DataQualityWarning;
