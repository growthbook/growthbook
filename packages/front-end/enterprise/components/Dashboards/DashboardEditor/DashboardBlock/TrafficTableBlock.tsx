import { TrafficTableBlockInterface } from "back-end/src/enterprise/validators/dashboard-block";
import { useMemo } from "react";
import VariationUsersTable from "@/components/Experiment/TabbedPage/VariationUsersTable";
import { BlockProps } from ".";

export default function TrafficTableBlock({
  analysis,
  experiment,
}: BlockProps<TrafficTableBlockInterface>) {
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

  const phaseObj = experiment.phases?.[experiment.phases.length - 1];

  const variations = experiment.variations.map((v, i) => ({
    id: v.key || i + "",
    name: v.name,
    weight: phaseObj?.variationWeights?.[i] || 0,
  }));

  return (
    <VariationUsersTable
      variations={variations}
      users={variationUsers}
      srm={results.srm}
    />
  );
}
