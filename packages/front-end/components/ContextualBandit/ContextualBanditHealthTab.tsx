import { useMemo } from "react";
import { Flex } from "@radix-ui/themes";
import { ApiContextualBanditInterface } from "shared/validators";
import { ExperimentReportVariation } from "shared/types/report";
import {
  getContextualBanditResultStatus,
  getHealthSettings,
} from "shared/enterprise";
import TrafficCard from "@/components/HealthTab/TrafficCard";
import MultipleExposuresCard from "@/components/HealthTab/MultipleExposuresCard";
import { IssueTags, IssueValue } from "@/components/HealthTab/IssueTags";
import Callout from "@/ui/Callout";
import { useContextualBanditResults } from "@/hooks/useContextualBandits";
import useOrgSettings from "@/hooks/useOrgSettings";
import ContextualBanditSRMCard from "./ContextualBanditSRMCard";

export default function ContextualBanditHealthTab({
  cb,
}: {
  cb: ApiContextualBanditInterface;
}) {
  const { results, latest } = useContextualBanditResults(cb.id);
  const orgSettings = useOrgSettings();

  const variations: ExperimentReportVariation[] = useMemo(
    () =>
      cb.variations.map((v, i) => ({
        id: v.id,
        index: i,
        name: v.name,
        weight:
          results?.overall.variations[i]?.weight ??
          (cb.variations.length ? 1 / cb.variations.length : 0),
      })),
    [cb.variations, results],
  );

  const overallUsers = useMemo(
    () =>
      cb.variations.map((_, i) => results?.overall.variations[i]?.users ?? 0),
    [cb.variations, results],
  );

  const traffic = latest?.traffic ?? null;
  const srm = latest?.srm?.pValue ?? null;
  const multipleExposures = latest?.multipleExposures ?? 0;

  // Base the balance check on the same per-variation units shown in the table and
  // used to compute the SRM p-value.
  const totalUsers = overallUsers.reduce((sum, n) => sum + n, 0);

  const resultStatus = useMemo(() => {
    const healthSettings = getHealthSettings(orgSettings);
    return getContextualBanditResultStatus({
      srm,
      multipleExposures,
      totalUsers,
      numOfVariations: variations.length,
      healthSettings,
    });
  }, [orgSettings, srm, multipleExposures, totalUsers, variations.length]);

  const healthIssues = useMemo<IssueValue[]>(() => {
    if (resultStatus?.status !== "unhealthy") return [];
    const issues: IssueValue[] = [];
    if (resultStatus.unhealthyData.srm) {
      issues.push({ label: "Balance", value: "balanceCheck" });
    }
    if (resultStatus.unhealthyData.multipleExposures) {
      issues.push({ label: "Multiple Exposures", value: "multipleExposures" });
    }
    return issues;
  }, [resultStatus]);

  if (!latest) {
    return (
      <Callout status="info">
        Start the Contextual Bandit to see health data.
      </Callout>
    );
  }

  return (
    <Flex direction="column">
      <IssueTags issues={healthIssues} />

      {traffic ? (
        <TrafficCard
          traffic={traffic}
          variations={variations}
          isBandit
          disableDimensions
        />
      ) : (
        <Callout status="info" mt="3">
          Traffic data will appear after a successful results refresh.
        </Callout>
      )}

      <div id="balanceCheck" style={{ scrollMarginTop: "100px" }}>
        <ContextualBanditSRMCard
          srm={srm}
          variations={variations}
          users={overallUsers}
          totalUsers={totalUsers}
          latestPeriod={latest?.srm?.latestPeriod ?? null}
        />
      </div>

      <div id="multipleExposures" style={{ scrollMarginTop: "100px" }}>
        <MultipleExposuresCard
          totalUsers={totalUsers}
          multipleExposures={multipleExposures}
        />
      </div>
    </Flex>
  );
}
