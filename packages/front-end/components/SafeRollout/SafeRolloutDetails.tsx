import { Box } from "@radix-ui/themes";
import { SafeRolloutInterface } from "back-end/src/validators/safe-rollout";
import SafeRolloutResults from "./SafeRolloutResults";

interface Props {
  safeRollout: SafeRolloutInterface;
}

export default function SafeRolloutDetails({ safeRollout }: Props) {
  return (
    <div>
      <div className="container-fluid pagecontents px-0 mt-2">
        <Box mb="4">
          <SafeRolloutResults safeRollout={safeRollout} />
        </Box>
      </div>
    </div>
  );
}
