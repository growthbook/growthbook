import { ExperimentTrafficGraphBlockInterface } from "back-end/src/enterprise/validators/dashboard-block";
import TrafficCard from "@/components/HealthTab/TrafficCard";
import useOrgSettings from "@/hooks/useOrgSettings";
import Callout from "@/components/Radix/Callout";
import { BlockProps } from ".";

export default function TrafficGraphBlock({
  block: { title },
  experiment,
  snapshot,
  ssrPolyfills,
}: BlockProps<ExperimentTrafficGraphBlockInterface>) {
  const { runHealthTrafficQuery } = useOrgSettings();

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

  const variations = experiment.variations.map((v, i) => ({
    id: v.key || i + "",
    name: v.name,
    weight: phaseObj?.variationWeights?.[i] || 0,
  }));

  const traffic = snapshot.health?.traffic;
  if (!traffic) return null; // Warning state handled by parent component

  return (
    <TrafficCard
      traffic={traffic}
      variations={variations}
      isBandit={experiment.type !== "multi-armed-bandit"}
      cardTitle={title.length > 0 ? title : undefined}
      disableDimensions
      my={0}
    />
  );
}
