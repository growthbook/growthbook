import { useState } from "react";
import { Box } from "@radix-ui/themes";
import Stepper from "@/components/Stepper/Stepper";

export default function StepperStories() {
  const [stepperStep, setStepperStep] = useState(0);

  return (
    <Box>
      <Stepper
        step={stepperStep}
        setStep={setStepperStep}
        setError={() => {}}
        steps={[
          { label: "Step 1", enabled: true },
          { label: "Step 2", enabled: true },
          { label: "Step 3", enabled: true },
        ]}
      />
    </Box>
  );
}
