import { FC, useState } from "react";
import { useFeatureIsOn } from "@growthbook/growthbook-react";
import NewExperimentForm from "@/components/Experiment/NewExperimentForm";
import SimpleNewExperimentForm from "@/components/Experiment/SimpleNewExperimentForm";

export type CreateExperimentModalProps = {
  onClose: () => void;
  source: string;
};

// Switches between the new one-step experiment-creation modal and the existing
// multi-step modal based on the "simple-experiment-flow" A/B test flag. Only
// the standard "create new experiment" entry points should render this; import,
// duplicate, idea, bandit, and template-detail flows keep using NewExperimentForm.
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
        onSwitchToLegacy={() => setUseOldFlow(true)}
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
