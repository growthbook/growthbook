import { Box, Flex, TextField } from "@radix-ui/themes";
import { useState } from "react";
import Dialog, { Size } from "./Dialog";
import Button from "./Button";
import { Select, SelectItem } from "./Select";
import Text from "./Text";
import Checkbox from "./Checkbox";

export default function DialogStories() {
  const [size, setSize] = useState<Size | null>(null);
  const [environment, setEnvironment] = useState("production");
  const [disableStickyBucketing, setDisableStickyBucketing] = useState(false);
  return (
    <>
      <Dialog
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
      </Dialog>
      <Flex direction="row" gap="3">
        <Button onClick={() => setSize("md")}>Medium Modal</Button>
        <Button onClick={() => setSize("lg")}>Large Modal</Button>
      </Flex>
    </>
  );
}
