import { FC, Fragment } from "react";
import {
  ExperimentInterfaceStringDates,
  ExperimentPhaseStringDates,
} from "back-end/types/experiment";
import { ExperimentSnapshotInterface } from "back-end/types/experiment-snapshot";
import SRMWarning from "./SRMWarning";
import isEqual from "lodash/isEqual";
import { useDefinitions } from "../../services/DefinitionsContext";
import { useContext } from "react";
import { UserContext } from "../ProtectedPage";
import Link from "next/link";

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
  const { getDatasourceById } = useDefinitions();

  const { permissions } = useContext(UserContext);

  if (!snapshot || !phase) return null;
  const results = snapshot.results[0];
  if (!results) return null;
  const variations = results?.variations || [];

  // Skip checks if experiment phase has extremely uneven weights
  // This causes too many false positives with the current data quality checks
  if (phase.variationWeights.filter((x) => x < 0.02).length > 0) {
    return null;
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
    .map((v, i) => (hasStringKeys ? v.key : null) || i + "")
    .sort();
  // Variation ids returned from the query
  const returnedVariations: string[] = variations
    .map((v, i) => {
      return {
        variation:
          (hasStringKeys ? experiment.variations[i]?.key : null) || i + "",
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
    // Data source is expecting numeric variation ids, but received string ids
    if (
      datasource &&
      !hasStringKeys &&
      snapshot.unknownVariations.filter((x) => isNaN(parseInt(x))).length > 0
    ) {
      return (
        <div className="alert alert-warning">
          <strong>Warning:</strong> Your data source is configured to expect
          numeric Variation Ids (<CommaList vals={definedVariations} />
          ), but it returned strings instead (
          <CommaList vals={returnedVariations} />
          ).{" "}
          {permissions.organizationSettings && (
            <Link href={`/datasources/${datasource.id}`}>
              <a>View settings</a>
            </Link>
          )}
        </div>
      );
    }

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
        <strong>Warning</strong>: Missing data from one or more variations.
      </div>
    );
  }

  // SRM check
  return <SRMWarning srm={results.srm} />;
};
export default DataQualityWarning;
