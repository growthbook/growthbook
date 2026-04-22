import { Box, Flex, TextField } from "@radix-ui/themes";
import { useState } from "react";
import FormDialog from "@/components/Dialog/FormDialog";
import Dialog, { Size } from "./Dialog";
import Button from "./Button";
import { Select, SelectItem } from "./Select";
import Text from "./Text";
import Checkbox from "./Checkbox";

export default function DialogStories() {
  const [size, setSize] = useState<Size | null>(null);
  const [composedOpen, setComposedOpen] = useState(false);
  const [environment, setEnvironment] = useState("production");
  const [disableStickyBucketing, setDisableStickyBucketing] = useState(false);
  return (
    <>
      {/* FormDialog is the opinionated wrapper around Dialog's composable
          primitives — header + body + Cancel/Save footer. */}
      <FormDialog
        open={!!size}
        header="GrowthBook Modal"
        headerAction={
          <Box width="140px">
            <Select value={environment} setValue={setEnvironment} size="1">
              <SelectItem value="production">Production</SelectItem>
              <SelectItem value="staging">Staging</SelectItem>
              <SelectItem value="development">Development</SelectItem>
            </Select>
          </Box>
        }
        subheader={`This is a ${size === "md" ? "medium" : "large"} example modal`}
        size={size ?? undefined}
        trackingEventModalType="test-modal"
        submit={() => {
          throw new Error("This is a test error");
        }}
        close={() => setSize(null)}
      >
        <Flex direction="column" gap="5">
          <Flex direction="column" gap="1">
            <Text weight="medium" size="small">
              Experiment name
            </Text>
            <TextField.Root placeholder="e.g. Homepage CTA test" />
          </Flex>
          <Flex direction="column" gap="1">
            <Text weight="medium" size="small">
              Hypothesis
            </Text>
            <TextField.Root placeholder="If we change X, we expect Y because Z" />
          </Flex>
          <Checkbox
            label="Disable Sticky Bucketing"
            value={disableStickyBucketing}
            setValue={setDisableStickyBucketing}
          />
        </Flex>
      </FormDialog>

      {/* Composable primitives for one-off layouts — no CTA props on Dialog
          itself. Consumers pick the buttons they want in Dialog.Footer. */}
      <Dialog.Root
        open={composedOpen}
        onOpenChange={setComposedOpen}
        size="md"
        trackingEventModalType="test-composed-dialog"
      >
        <Dialog.Header>
          <Dialog.Title>Composed Dialog</Dialog.Title>
        </Dialog.Header>
        <Dialog.Description>
          Built directly from Dialog.Root / Header / Body / Footer primitives.
        </Dialog.Description>
        <Dialog.Body>
          <Text size="medium">
            The Dialog component does not know what a CTA is — the footer just
            renders whichever buttons you put in it.
          </Text>
        </Dialog.Body>
        <Dialog.Footer justify="between">
          <Button color="red" variant="soft">
            Delete
          </Button>
          <Flex gap="3">
            <Dialog.Close>
              <Button variant="ghost" onClick={() => setComposedOpen(false)}>
                Cancel
              </Button>
            </Dialog.Close>
            <Button onClick={() => setComposedOpen(false)}>Continue</Button>
          </Flex>
        </Dialog.Footer>
      </Dialog.Root>

      <Flex direction="row" gap="3">
        <Button onClick={() => setSize("md")}>Medium Modal</Button>
        <Button onClick={() => setSize("lg")}>Large Modal</Button>
        <Button onClick={() => setComposedOpen(true)}>Composed Modal</Button>
      </Flex>
    </>
  );
}
