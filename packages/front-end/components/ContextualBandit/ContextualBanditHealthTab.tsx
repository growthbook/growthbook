import { useMemo } from "react";
import { Flex } from "@radix-ui/themes";
import { ApiContextualBanditInterface } from "shared/validators";
import { ExperimentReportVariation } from "shared/types/report";
import TrafficCard from "@/components/HealthTab/TrafficCard";
import MultipleExposuresCard from "@/components/HealthTab/MultipleExposuresCard";
import { IssueTags } from "@/components/HealthTab/IssueTags";
import Callout from "@/ui/Callout";
import {
  useContextualBanditHealthIssues,
  useContextualBanditResults,
} from "@/hooks/useContextualBandits";
import ContextualBanditSRMCard from "./ContextualBanditSRMCard";

export default function ContextualBanditHealthTab({
  cb,
}: {
  cb: ApiContextualBanditInterface;
}) {
  const { results, latest } = useContextualBanditResults(cb.id);
  const healthIssues = useContextualBanditHealthIssues(cb);

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

  const traffic = latest?.traffic ?? null;
  const srm = latest?.srm?.pValue ?? null;
  const multipleExposures = latest?.multipleExposures ?? 0;
  const overallUsers = useMemo(
    () =>
      cb.variations.map((_, i) => traffic?.overall?.variationUnits?.[i] ?? 0),
    [cb.variations, traffic],
  );

  const totalUsers = overallUsers.reduce((sum, n) => sum + n, 0);

  if (!latest) {
    return (
      <Callout status="info">
        Start the Contextual Bandit to see health data.
      </Callout>
    );
  }

  if (!traffic || totalUsers === 0) {
    return (
      <Callout status="info" mt="3">
        Traffic data will appear after a successful results refresh.
      </Callout>
    );
  }

  return (
    <Flex direction="column">
      <IssueTags issues={healthIssues} />

      <TrafficCard
        traffic={traffic}
        variations={variations}
        isBandit
        disableDimensions
      />

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
