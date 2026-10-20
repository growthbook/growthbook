import { FC } from "react";
import {
  ExperimentReportResultDimension,
  ExperimentReportVariation,
} from "shared/types/report";
import { ExperimentSnapshotInterface } from "shared/types/experiment-snapshot";
import { getSRMHealthData } from "shared/health";
import {
  DEFAULT_SRM_THRESHOLD,
  DEFAULT_SRM_MINIMINUM_COUNT_PER_VARIATION,
} from "shared/constants";
import { useUser } from "@/services/UserContext";
import SRMWarning from "./SRMWarning";
import { ExperimentTab } from "./TabbedPage";

const DataQualityWarning: FC<{
  results: ExperimentReportResultDimension;
  variations: ExperimentReportVariation[];
  linkToHealthTab?: boolean;
  setTab?: (tab: ExperimentTab) => void;
  isBandit?: boolean;
  snapshot?: ExperimentSnapshotInterface;
}> = ({
  results,
  variations,
  linkToHealthTab = false,
  setTab,
  isBandit,
  snapshot,
}) => {
  const { settings } = useUser();
  const srmThreshold = settings.srmThreshold ?? DEFAULT_SRM_THRESHOLD;

  if (!results) return null;
  const variationResults = results?.variations || [];

  // Skip checks if experiment phase has extremely uneven weights
  // This causes too many false positives with the current data quality checks
  if (variations.filter((x) => x.weight < 0.02).length > 0) {
    return null;
  }

  const traffic = snapshot?.health?.traffic;
  const trafficResults =
    traffic && !traffic.error && traffic.overall.variationUnits.length
      ? traffic.overall
      : null;

  // Use health traffic results when available
  const srm = trafficResults?.srm ?? results.srm;
  const users =
    trafficResults?.variationUnits ?? variationResults.map((r) => r.users);

  if (trafficResults) {
    const totalUsers = users.reduce((a, b) => a + b, 0);
    const srmHealth = getSRMHealthData({
      srm,
      srmThreshold,
      numOfVariations: variations.length,
      totalUsersCount: totalUsers,
      minUsersPerVariation: DEFAULT_SRM_MINIMINUM_COUNT_PER_VARIATION,
    });
    if (srmHealth === "not-enough-traffic") return null;
  }

  return (
    <SRMWarning
      srm={srm}
      variations={variations}
      users={users}
      linkToHealthTab={linkToHealthTab}
      setTab={setTab}
      isBandit={isBandit}
    />
  );
};
export default DataQualityWarning;
