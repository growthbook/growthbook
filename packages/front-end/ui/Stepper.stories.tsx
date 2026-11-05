import { useState } from "react";
import { Box } from "@radix-ui/themes";
import Stepper from "@/components/Stepper/Stepper";
import { StoryMeta } from "@/ui/storyMeta";

export const meta: StoryMeta = {
  name: "Stepper",
  category: "navigation",
  status: "stable",
  summary:
    "A row of numbered steps that shows progress through a multi-step flow and lets the user move between steps.",
  useWhen: ["Show where the user is in a multi-step form or wizard."],
  avoidWhen: [
    {
      reason: "The sections are peers with no order.",
      use: "Tabs",
    },
    {
      reason: "You only need to show progress, not navigate.",
      use: "ProgressBar",
    },
  ],
  related: ["Tabs", "ProgressBar"],
};

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
