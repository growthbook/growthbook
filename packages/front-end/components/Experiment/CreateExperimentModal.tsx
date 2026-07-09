import { FC, useState } from "react";
import { useFeatureIsOn } from "@growthbook/growthbook-react";
import NewExperimentForm from "@/components/Experiment/NewExperimentForm";
import SimpleNewExperimentForm from "@/components/Experiment/SimpleNewExperimentForm";
import track from "@/services/track";

export type CreateExperimentModalProps = {
  onClose: () => void;
  source: string;
};

const CreateExperimentModal: FC<CreateExperimentModalProps> = ({
  onClose,
  source,
}) => {
  const simpleFlow = useFeatureIsOn("simple-experiment-flow");
  const [useOldFlow, setUseOldFlow] = useState(false);

  if (simpleFlow && !useOldFlow) {
    return (
      <SimpleNewExperimentForm
        onClose={onClose}
        source={source}
        onSwitchToLegacy={() => {
          track("Switch to legacy experiment flow");
          setUseOldFlow(true);
        }}
      />
    );
  }

  return (
    <NewExperimentForm
      onClose={onClose}
      source={source}
      isNewExperiment={true}
    />
  );
};

export default CreateExperimentModal;
