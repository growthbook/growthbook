import { TrafficTableBlockInterface } from "back-end/src/enterprise/validators/dashboard-block";
import { useMemo } from "react";
import { useExperiments } from "@/hooks/useExperiments";
import VariationUsersTable from "@/components/Experiment/TabbedPage/VariationUsersTable";
import { useDashboardSnapshot } from "../../DashboardSnapshotProvider";
import { BlockProps } from ".";

export default function TrafficTableBlock({
  block,
  setBlock,
}: BlockProps<TrafficTableBlockInterface>) {
  const { experimentId } = block;
  const { experimentsMap } = useExperiments();
  const experiment = experimentsMap.get(experimentId);
  const { analysis } = useDashboardSnapshot(block, setBlock);
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

  if (!experiment || !results) return null;
  const phaseObj = experiment.phases?.[experiment.phases.length - 1];

  const variations = experiment.variations.map((v, i) => {
    return {
      id: v.key || i + "",
      name: v.name,
      weight: phaseObj?.variationWeights?.[i] || 0,
    };
  });

  return (
    <VariationUsersTable
      variations={variations}
      users={variationUsers}
      srm={results.srm}
    />
  );
}
