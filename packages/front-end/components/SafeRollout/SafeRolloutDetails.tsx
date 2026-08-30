import { Box } from "@radix-ui/themes";
import { SafeRolloutInterface } from "shared/validators";
import { SignificanceThresholds } from "shared/types/stats";
import useConfidenceLevels from "@/hooks/useConfidenceLevels";
import usePValueThreshold from "@/hooks/usePValueThreshold";
import SafeRolloutResults from "./SafeRolloutResults";

interface Props {
  safeRollout: SafeRolloutInterface;
  projectId: string | undefined;
}

export default function SafeRolloutDetails({ safeRollout, projectId }: Props) {
  const bayesianConfidenceLevels = useConfidenceLevels(projectId);
  const pValueThreshold = usePValueThreshold(projectId);
  const significanceThresholds: SignificanceThresholds = {
    bayesianConfidenceLevels,
    pValueThreshold,
  };

  return (
    <div>
      <div className="container-fluid pagecontents p-0">
        <Box mb="2">
          <SafeRolloutResults
            safeRollout={safeRollout}
            significanceThresholds={significanceThresholds}
          />
        </Box>
      </div>
    </div>
  );
}
