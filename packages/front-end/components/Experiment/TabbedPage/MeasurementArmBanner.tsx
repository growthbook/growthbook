import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { useContextualBandit } from "@/hooks/useContextualBandits";
import Callout from "@/ui/Callout";
import Link from "@/ui/Link";

export default function MeasurementArmBanner({
  experiment,
}: {
  experiment: ExperimentInterfaceStringDates;
}) {
  const cbId = experiment.contextualBanditId;
  const { contextualBandit } = useContextualBandit(cbId);
  const cbName = contextualBandit?.name;

  return (
    <Callout status="info" mb="3">
      Measurement arm for{" "}
      {cbId ? (
        <Link href={`/contextual-bandit/${cbId}`}>
          <strong>{cbName ?? cbId}</strong>
        </Link>
      ) : (
        "this Contextual Bandit"
      )}
      : compares users held back on the default experience against users in the
      Bandit. Variations, traffic, targeting, status and the goal metric follow
      the Bandit; only secondary and guardrail metrics can be changed here.
    </Callout>
  );
}
