import { Flex, TextField } from "@radix-ui/themes";
import { useState } from "react";
import Button from "@/ui/Button";
import Text from "@/ui/Text";
import { Select, SelectItem } from "@/ui/Select";
import Checkbox from "@/ui/Checkbox";
import ModalPaged from "./ModalPaged";

export default function ModalPagedStories() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [environment, setEnvironment] = useState("production");
  const [confirmed, setConfirmed] = useState(false);

  const close = () => {
    setOpen(false);
    setStep(0);
    setName("");
    setEnvironment("production");
    setConfirmed(false);
  };

  return (
    <>
      <ModalPaged
        open={open}
        close={close}
        step={step}
        setStep={setStep}
        header="Create Experiment"
        subheader="A short wizard showing the ModalPaged pattern."
        size="lg"
        trackingEventModalType="modal-paged-story"
        submit={async () => {
          await new Promise((r) => setTimeout(r, 400));
        }}
      >
        <ModalPaged.Page
          display="Details"
          validate={async () => {
            if (!name.trim()) {
              throw new Error("Please enter an experiment name to continue.");
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
              <Text weight="semibold">Environment</Text>
              <Select value={environment} size="2" setValue={setEnvironment}>
                <SelectItem value="production">Production</SelectItem>
                <SelectItem value="staging">Staging</SelectItem>
                <SelectItem value="development">Development</SelectItem>
              </Select>
            </Flex>
          </Flex>
        </ModalPaged.Page>
        <ModalPaged.Page display="Targeting">
          <Flex direction="column" gap="3">
            <Text>
              Configure who should see this experiment. Targeting rules would
              normally go here.
            </Text>
          </Flex>
        </ModalPaged.Page>
        <ModalPaged.Page
          display="Review"
          validate={async () => {
            if (!confirmed) {
              throw new Error("You must confirm before saving.");
            }
          }}
        >
          <Flex direction="column" gap="4">
            <Text>
              Name: <strong>{name || "(unset)"}</strong>
            </Text>
            <Text>
              Environment: <strong>{environment}</strong>
            </Text>
            <Checkbox
              label="I have reviewed these settings"
              value={confirmed}
              setValue={setConfirmed}
            />
          </Flex>
        </ModalPaged.Page>
      </ModalPaged>

      <Button onClick={() => setOpen(true)}>Open Paged Modal</Button>
    </>
  );
}
