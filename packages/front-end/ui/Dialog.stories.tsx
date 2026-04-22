import { Box, Flex, TextField } from "@radix-ui/themes";
import { useState } from "react";
import DialogForm, { useDialogForm } from "@/components/Dialog/DialogForm";
import Stepper from "@/components/Stepper/Stepper";
import Dialog, { Size } from "./Dialog";
import Button from "./Button";
import { Select, SelectItem } from "./Select";
import Text from "./Text";
import Checkbox from "./Checkbox";

export default function DialogStories() {
  const [size, setSize] = useState<Size | null>(null);
  const [environment, setEnvironment] = useState("production");
  const [disableStickyBucketing, setDisableStickyBucketing] = useState(false);
  const { loading } = useDialogForm();
  const [wizardOpen, setWizardOpen] = useState(false);
  return (
    <>
      <Dialog.Root
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        trackingEventModalType="test-wizard-dialog"
      >
        <Dialog.Header>
          <Dialog.Title>Configure experiment</Dialog.Title>
        </Dialog.Header>
        <Dialog.Description>
          <Box mb="4" mt="2" ml="-5">
            <Stepper
              steps={[
                { label: "Step 1", enabled: true },
                { label: "Step 2", enabled: true },
                { label: "Step 3", enabled: true },
              ]}
              step={2}
              setStep={() => {}}
              setError={() => {}}
            />
          </Box>
        </Dialog.Description>
        <Dialog.Body>
          <Flex direction="column" gap="5">
            <Flex direction="column" gap="1">
              <Text weight="semibold">Target audience</Text>
              <TextField.Root placeholder="e.g. US users on mobile" />
            </Flex>
            <Flex direction="column" gap="1">
              <Text weight="semibold">Traffic allocation</Text>
              <TextField.Root placeholder="e.g. 50%" />
            </Flex>
          </Flex>
        </Dialog.Body>
        <Dialog.Footer justify="between">
          <Button variant="outline" onClick={() => setWizardOpen(false)}>
            Back
          </Button>
          <Flex gap="3">
            <Dialog.Close>
              <Button variant="ghost" onClick={() => setWizardOpen(false)}>
                Cancel
              </Button>
            </Dialog.Close>
            <Button onClick={() => setWizardOpen(false)}>Continue</Button>
          </Flex>
        </Dialog.Footer>
      </Dialog.Root>

      <Dialog.Root
        open={!!size}
        onOpenChange={(open) => {
          if (!open) setSize(null);
        }}
        size={size ?? "md"}
        trackingEventModalType="test-modal"
      >
        <DialogForm
          onSubmit={() => {
            throw new Error("This is a test error");
          }}
        >
          <Dialog.Header>
            <Dialog.Title>GrowthBook Modal</Dialog.Title>
            <Box width="140px">
              <Select value={environment} setValue={setEnvironment} size="1">
                <SelectItem value="production">Production</SelectItem>
                <SelectItem value="staging">Staging</SelectItem>
                <SelectItem value="development">Development</SelectItem>
              </Select>
            </Box>
          </Dialog.Header>
          <Dialog.Description>
            {`This is a ${size === "md" ? "medium" : "large"} example modal`}
          </Dialog.Description>
          <Dialog.Body>
            <Flex direction="column" gap="5">
              <Flex direction="column" gap="1">
                <Text weight="semibold">Experiment name</Text>
                <TextField.Root placeholder="e.g. Homepage CTA test" />
              </Flex>
              <Flex direction="column" gap="1">
                <Text weight="semibold">Hypothesis</Text>
                <TextField.Root placeholder="If we change X, we expect Y because Z" />
              </Flex>
              <Checkbox
                label="Disable Sticky Bucketing"
                value={disableStickyBucketing}
                setValue={setDisableStickyBucketing}
              />
            </Flex>
          </Dialog.Body>
          <Dialog.Footer>
            <Dialog.Close>
              <Button variant="ghost" onClick={() => setSize(null)}>
                Cancel
              </Button>
            </Dialog.Close>
            <Button type="submit" loading={loading}>
              Save
            </Button>
          </Dialog.Footer>
        </DialogForm>
      </Dialog.Root>

      <Flex direction="row" gap="3">
        <Button onClick={() => setSize("md")}>Medium Dialog</Button>
        <Button onClick={() => setSize("lg")}>Large Dialog</Button>
        <Button onClick={() => setWizardOpen(true)}>Wizard Dialog</Button>
      </Flex>
    </>
  );
}
