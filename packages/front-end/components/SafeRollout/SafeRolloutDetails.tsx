import { Box } from "@radix-ui/themes";
import { SafeRolloutInterface } from "shared/src/validators/safe-rollout";
import SafeRolloutResults from "./SafeRolloutResults";

interface Props {
  safeRollout: SafeRolloutInterface;
}

export default function SafeRolloutDetails({ safeRollout }: Props) {
  return (
    <div>
      <div className="container-fluid pagecontents p-0">
        <Box mb="2">
          <SafeRolloutResults safeRollout={safeRollout} />
        </Box>
      </div>
    </div>
  );
}
