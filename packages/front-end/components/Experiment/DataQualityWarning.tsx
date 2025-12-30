import { FC } from "react";
import {
  ExperimentReportResultDimension,
  ExperimentReportVariation,
} from "shared/types/report";
import SRMWarning from "./SRMWarning";
import { ExperimentTab } from "./TabbedPage";

const DataQualityWarning: FC<{
  results: ExperimentReportResultDimension;
  variations: ExperimentReportVariation[];
  linkToHealthTab?: boolean;
  setTab?: (tab: ExperimentTab) => void;
  isBandit?: boolean;
}> = ({ results, variations, linkToHealthTab = false, setTab, isBandit }) => {
  if (!results) return null;
  const variationResults = results?.variations || [];

  // Skip checks if experiment phase has extremely uneven weights
  // This causes too many false positives with the current data quality checks
  if (variations.filter((x) => x.weight < 0.02).length > 0) {
    return null;
  }

  // SRM check
  return (
    <SRMWarning
      srm={results.srm}
      variations={variations}
      users={variationResults.map((r) => r.users)}
      linkToHealthTab={linkToHealthTab}
      setTab={setTab}
      isBandit={isBandit}
    />
  );
};
export default DataQualityWarning;
