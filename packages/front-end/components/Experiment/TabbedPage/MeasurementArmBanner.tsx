import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import useApi from "@/hooks/useApi";
import Callout from "@/ui/Callout";
import Link from "@/ui/Link";

export default function MeasurementArmBanner({
  experiment,
}: {
  experiment: ExperimentInterfaceStringDates;
}) {
  const cbId = experiment.contextualBanditId;
  const { data } = useApi<{ contextualBandit?: { name: string } }>(
    cbId ? `/api/v1/contextual-bandits/${cbId}` : "",
    { shouldRun: () => !!cbId },
  );
  const cbName = data?.contextualBandit?.name;

  return (
    <Callout status="info" mb="3">
      This experiment measures the overall lift of the contextual bandit{" "}
      {cbId ? (
        <Link href={`/contextual-bandit/${cbId}`}>
          <strong>{cbName ?? cbId}</strong>
        </Link>
      ) : (
        "it wraps"
      )}
      . Its variations, traffic, targeting, status and goal metric are managed
      from the bandit; only the analysis settings can be changed here.
    </Callout>
  );
}
