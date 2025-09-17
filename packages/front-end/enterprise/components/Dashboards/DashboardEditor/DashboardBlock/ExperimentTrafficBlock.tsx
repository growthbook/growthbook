import { ExperimentTrafficBlockInterface } from "back-end/src/enterprise/validators/dashboard-block";
import { useMemo } from "react";
import TrafficCard from "@/components/HealthTab/TrafficCard";
import useOrgSettings from "@/hooks/useOrgSettings";
import Callout from "@/ui/Callout";
import VariationUsersTable from "@/components/Experiment/TabbedPage/VariationUsersTable";
import { BlockProps } from ".";

export default function ExperimentTrafficBlock({
  block: { showTable, showTimeseries },
  experiment,
  snapshot,
  analysis,
  ssrPolyfills,
}: BlockProps<ExperimentTrafficBlockInterface>) {
  const { runHealthTrafficQuery } = useOrgSettings();

  const healthTrafficQueryRunning =
    ssrPolyfills?.useOrgSettings()?.runHealthTrafficQuery ||
    runHealthTrafficQuery;

  const phaseObj = experiment.phases?.[experiment?.phases.length - 1];
  const results = useMemo(() => analysis?.results[0], [analysis]);

  const [_totalUsers, variationUsers] = useMemo(() => {
    let totalUsers = 0;
    const variationUsers: number[] = [];
    results?.variations?.forEach((v, i) => {
      totalUsers += v.users;
      variationUsers[i] = variationUsers[i] || 0;
      variationUsers[i] += v.users;
    });
    return [totalUsers, variationUsers];
  }, [results]);

  const variations = experiment.variations.map((v, i) => ({
    id: v.key || i + "",
    name: v.name,
    weight: phaseObj?.variationWeights?.[i] || 0,
  }));

  if (showTimeseries) {
    if (!healthTrafficQueryRunning) {
      return (
        <Callout status="info" mt="3">
          Health queries are disabled in your Organization Settings. To enable
          them, visit the Health tab and follow the onboarding steps
        </Callout>
      );
    }
    if (!snapshot.health?.traffic) return null; // Warning state handled by parent component
  }

  return (
    <>
      {showTable && (
        <VariationUsersTable
          variations={variations}
          users={variationUsers}
          srm={results?.srm}
        />
      )}
      {showTimeseries && (
        <TrafficCard
          traffic={snapshot.health!.traffic}
          variations={variations}
          isBandit={experiment.type !== "multi-armed-bandit"}
          cardTitle={""}
          disableDimensions
          containerClassName="p-0"
        />
      )}
    </>
  );
}
