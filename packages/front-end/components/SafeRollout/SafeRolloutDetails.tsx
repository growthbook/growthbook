import { Box } from "@radix-ui/themes";
import { SafeRolloutInterface } from "back-end/src/validators/safe-rollout";
import { SafeRolloutRule } from "back-end/src/validators/features";
import SafeRolloutResults from "./SafeRolloutResults";
import DecisionBanner from "./DecisionBanner";

interface Props {
  safeRollout: SafeRolloutInterface;
  rule: SafeRolloutRule;
  openStatusModal: () => void;
}

export default function SafeRolloutDetails({
  safeRollout,
  rule,
  openStatusModal,
}: Props) {
  return (
    <div>
      {rule.enabled && (
        <DecisionBanner openStatusModal={openStatusModal} rule={rule} />
      )}
      <div className="container-fluid pagecontents px-0 mt-4">
        <Box mb="6">
          <SafeRolloutResults safeRollout={safeRollout} />
        </Box>
      </div>
    </div>
  );
}
