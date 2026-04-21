import { Box } from "@radix-ui/themes";
import { SafeRolloutInterface } from "shared/validators";
import SafeRolloutResults from "./SafeRolloutResults";

interface Props {
  safeRollout: SafeRolloutInterface;
  projectId: string | undefined;
}

export default function SafeRolloutDetails({ safeRollout, projectId }: Props) {
  return (
    <div>
      <div className="container-fluid pagecontents p-0">
        <Box mb="2">
          <SafeRolloutResults safeRollout={safeRollout} projectId={projectId} />
        </Box>
      </div>
    </div>
  );
}
