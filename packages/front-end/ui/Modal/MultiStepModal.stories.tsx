import { Flex, TextField } from "@radix-ui/themes";
import { useState } from "react";
import { Size } from "@/ui/Modal";
import Button from "../Button";
import Callout from "../Callout";
import Checkbox from "../Checkbox";
import Link from "../Link";
import Text from "../Text";
import MultiStepModal, { useMultiStepModal } from "./MultiStepModal";

// Demonstrates the opt-in navigation hook: a "go back and edit" affordance
// rendered inside a later step's content, jumping the flow via goToStep.
function ReviewStep({
  name,
  hypothesis,
  disableStickyBucketing,
}: {
  name: string;
  hypothesis: string;
  disableStickyBucketing: boolean;
}) {
  const { goToStep } = useMultiStepModal();
  return (
    <Flex direction="column" gap="3">
      <Callout status="info">
        Review the experiment before creating it.{" "}
        <Link onClick={() => goToStep(0)}>Edit overview</Link>
      </Callout>
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
  );
}

export default function MultiStepModalStories() {
  const [size, setSize] = useState<Size | null>(null);

  const [name, setName] = useState("");
  const [hypothesis, setHypothesis] = useState("");
  const [disableStickyBucketing, setDisableStickyBucketing] = useState(false);

  const close = () => setSize(null);

  return (
    <>
      {size && (
        <MultiStepModal.Root
          open={!!size}
          size={size}
          title="New Experiment"
          onClose={close}
          cta="Create"
          submit={async () => {
            // Pretend to persist the new experiment.
            await new Promise((resolve) => setTimeout(resolve, 400));
          }}
          trackingEventModalType="multi-step-modal-example"
        >
          <MultiStepModal.Step
            display="Overview"
            nextEnabled={!!name.trim()}
            disabledMessage="Enter an experiment name to continue"
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
            <ReviewStep
              name={name}
              hypothesis={hypothesis}
              disableStickyBucketing={disableStickyBucketing}
            />
          </MultiStepModal.Step>
        </MultiStepModal.Root>
      )}

      <Flex direction="row" gap="3" wrap="wrap">
        <Button onClick={() => setSize("md")}>Medium Multi-Step Modal</Button>
        <Button onClick={() => setSize("lg")}>Large Multi-Step Modal</Button>
      </Flex>
    </>
  );
}
