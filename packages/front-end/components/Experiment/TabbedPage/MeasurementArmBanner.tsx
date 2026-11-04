import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { useContextualBandit } from "@/hooks/useContextualBandits";
import Callout from "@/ui/Callout";
import Link from "@/ui/Link";
import Text from "@/ui/Text";

export default function MeasurementArmBanner({
  experiment,
}: {
  experiment: ExperimentInterfaceStringDates;
}) {
  const cbId = experiment.contextualBanditId;
  const { contextualBandit } = useContextualBandit(cbId);
  const cbName = contextualBandit?.name;

  return (
    <Callout status="info" mt="3" mb="3">
      Measurement arm for{" "}
      {cbId ? (
        <Link href={`/contextual-bandit/${cbId}`}>
          <Text weight="semibold">{cbName ?? cbId}</Text>
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
