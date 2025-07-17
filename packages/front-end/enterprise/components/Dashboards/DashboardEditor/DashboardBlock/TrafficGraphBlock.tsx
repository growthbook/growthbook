import { TrafficGraphBlockInterface } from "back-end/src/enterprise/validators/dashboard-block";
import { useExperiments } from "@/hooks/useExperiments";
import TrafficCard from "@/components/HealthTab/TrafficCard";
import useOrgSettings from "@/hooks/useOrgSettings";
import Callout from "@/components/Radix/Callout";
import { useDashboardSnapshot } from "../../DashboardSnapshotProvider";
import { BlockProps } from ".";

export default function TrafficGraphBlock({
  block,
  setBlock,
  ssrPolyfills,
}: BlockProps<TrafficGraphBlockInterface>) {
  const { experimentId } = block;
  const { experimentsMap } = useExperiments();
  const experiment = experimentsMap.get(experimentId);
  const { snapshot } = useDashboardSnapshot(block, setBlock);
  const { runHealthTrafficQuery } = useOrgSettings();
  if (!experiment || !snapshot) return null;

  const healthTrafficQueryRunning =
    ssrPolyfills?.useOrgSettings()?.runHealthTrafficQuery ||
    runHealthTrafficQuery;

  if (!healthTrafficQueryRunning) {
    return (
      <Callout status="info" mt="3">
        Health queries are disabled in your Organization Settings. To enable
        them, visit the Health tab and follow the onboarding steps
      </Callout>
    );
  }

  const phaseObj = experiment.phases?.[experiment?.phases.length - 1];

  const variations = experiment.variations.map((v, i) => {
    return {
      id: v.key || i + "",
      name: v.name,
      weight: phaseObj?.variationWeights?.[i] || 0,
    };
  });

  const traffic = snapshot.health?.traffic;

  if (!traffic) {
    return (
      <Callout status="info" mt="3">
        Unable to load the experiment health check results. Check the Health
        tab, or try refreshing the experiment results.
      </Callout>
    );
  }

  return (
    <TrafficCard
      traffic={traffic}
      variations={variations}
      isBandit={experiment.type !== "multi-armed-bandit"}
      cardTitle={block.title.length > 0 ? block.title : undefined}
      disableDimensions
    />
  );
}
