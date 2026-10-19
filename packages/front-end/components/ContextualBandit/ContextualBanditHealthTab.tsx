import { useMemo } from "react";
import { Flex } from "@radix-ui/themes";
import { ApiContextualBanditInterface } from "shared/validators";
import { ExperimentReportVariation } from "shared/types/report";
import TrafficCard from "@/components/HealthTab/TrafficCard";
import MultipleExposuresCard from "@/components/HealthTab/MultipleExposuresCard";
import { IssueTags } from "@/components/HealthTab/IssueTags";
import LoadingSpinner from "@/components/LoadingSpinner";
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
  const { results, latest, loading, error } = useContextualBanditResults(cb.id);
  const healthIssues = useContextualBanditHealthIssues(cb);

  // Build the labels and per-variation values from `results.overall.variations` rather than
  // matching positions against `cb.variations` — otherwise a removed or pending
  // arm shifts every slot and mislabels (or drops) the counts.
  const frozenVariations = useMemo(
    () => results?.overall.variations ?? [],
    [results],
  );

  const variations: ExperimentReportVariation[] = useMemo(
    () =>
      frozenVariations.map((v, i) => ({
        id: v.variationId,
        index: i,
        name: v.variationName ?? v.variationId,
        weight:
          v.weight ??
          (frozenVariations.length ? 1 / frozenVariations.length : 0),
      })),
    [frozenVariations],
  );

  const traffic = latest?.traffic ?? null;
  const srm = latest?.srm?.pValue ?? null;
  const multipleExposures = latest?.multipleExposures ?? 0;
  const overallUsers = useMemo(
    () =>
      frozenVariations.map(
        (_, i) => traffic?.overall?.variationUnits?.[i] ?? 0,
      ),
    [frozenVariations, traffic],
  );

  const totalUsers = overallUsers.reduce((sum, n) => sum + n, 0);

  if (loading) {
    return (
      <Callout status="info" mt="3" icon={<LoadingSpinner />}>
        Snapshot refreshing, health data loading...
      </Callout>
    );
  }

  if (error) {
    return (
      <Callout status="error" mt="3">
        {error.message}
      </Callout>
    );
  }

  if (!latest) {
    return (
      <Callout status="info" mt="3">
        No updates yet. Traffic and health results will appear after a
        successful refresh of the results.
      </Callout>
    );
  }

  if (!traffic) {
    return (
      <Callout status="info" mt="3">
        Traffic data will appear after a successful results refresh.
      </Callout>
    );
  }

  if (totalUsers === 0) {
    return (
      <Callout status="info" mt="3">
        No data found. It is likely there are no units in your Bandit yet.
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
        overTimeTitle="Traffic Over Time"
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
