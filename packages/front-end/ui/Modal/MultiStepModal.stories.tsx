import { Flex, TextField } from "@radix-ui/themes";
import { useState } from "react";
import { Size } from "@/ui/Modal";
import Button from "../Button";
import Checkbox from "../Checkbox";
import Text from "../Text";
import MultiStepModal from "./MultiStepModal";

export default function MultiStepModalStories() {
  const [size, setSize] = useState<Size | null>(null);
  const [step, setStep] = useState(0);

  const [name, setName] = useState("");
  const [hypothesis, setHypothesis] = useState("");
  const [disableStickyBucketing, setDisableStickyBucketing] = useState(false);

  const open = (nextSize: Size) => {
    setStep(0);
    setSize(nextSize);
  };
  const close = () => setSize(null);

  return (
    <>
      {size && (
        <MultiStepModal.Root
          open={!!size}
          size={size}
          step={step}
          setStep={setStep}
          header="New Experiment"
          close={close}
          cta="Create"
          backButton
          submit={async () => {
            // Pretend to persist the new experiment.
            await new Promise((resolve) => setTimeout(resolve, 400));
          }}
          trackingEventModalType="multi-step-modal-example"
        >
          <MultiStepModal.Step
            display="Overview"
            validate={async () => {
              if (!name.trim()) {
                throw new Error("Enter an experiment name to continue");
              }
            }}
          >
            <Flex direction="column" gap="5">
              <Flex direction="column" gap="1">
                <Text weight="semibold">Experiment name</Text>
                <TextField.Root
                  placeholder="e.g. Homepage CTA test"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </Flex>
              <Flex direction="column" gap="1">
                <Text weight="semibold">Hypothesis</Text>
                <TextField.Root
                  placeholder="If we change X, we expect Y because Z"
                  value={hypothesis}
                  onChange={(e) => setHypothesis(e.target.value)}
                />
              </Flex>
            </Flex>
          </MultiStepModal.Step>
          <MultiStepModal.Step display="Targeting">
            <Flex direction="column" gap="5">
              <Text>
                Choose who is included in this experiment. This step is left
                intentionally light to show the body swapping between pages.
              </Text>
              <Checkbox
                label="Disable Sticky Bucketing"
                value={disableStickyBucketing}
                setValue={setDisableStickyBucketing}
              />
            </Flex>
          </MultiStepModal.Step>
          <MultiStepModal.Step display="Review">
            <Flex direction="column" gap="3">
              <Text>Review the experiment before creating it.</Text>
              <Text>
                <strong>Name:</strong> {name || "—"}
              </Text>
              <Text>
                <strong>Hypothesis:</strong> {hypothesis || "—"}
              </Text>
              <Text>
                <strong>Sticky Bucketing:</strong>{" "}
                {disableStickyBucketing ? "Disabled" : "Enabled"}
              </Text>
            </Flex>
          </MultiStepModal.Step>
        </MultiStepModal.Root>
      )}

      <Flex direction="row" gap="3" wrap="wrap">
        <Button onClick={() => open("md")}>Medium Multi-Step Modal</Button>
        <Button onClick={() => open("lg")}>Large Multi-Step Modal</Button>
      </Flex>
    </>
  );
}
