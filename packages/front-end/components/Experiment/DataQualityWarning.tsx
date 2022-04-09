import { FC } from "react";
import SRMWarning from "./SRMWarning";
import {
  ExperimentReportResultDimension,
  ExperimentReportVariation,
} from "back-end/types/report";

const DataQualityWarning: FC<{
  results: ExperimentReportResultDimension;
  variations: ExperimentReportVariation[];
}> = ({ results, variations }) => {
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
  if (totalUsers < 8 * variations.length) {
    return null;
  }

  // SRM check
  return (
    <SRMWarning
      srm={results.srm}
      expected={variations.map((v) => v.weight)}
      observed={results.variations.map((v) => v.users)}
    />
  );
};
export default DataQualityWarning;
