import { Box, Flex } from "@radix-ui/themes";
import { useState } from "react";
import Dialog, { Size } from "./Dialog";
import Button from "./Button";
import { Select, SelectItem } from "./Select";
import Text from "./Text";

export default function DialogStories() {
  const [size, setSize] = useState<Size | null>(null);
  const [environment, setEnvironment] = useState("production");
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
        subheader="This is an example modal with a subheading"
        size={size ?? undefined}
        trackingEventModalType="test-modal"
        submit={() => {
          throw new Error("This is a test error");
        }}
        close={() => setSize(null)}
      >
        <Text>This is a medium modal</Text>
      </Dialog>
      <Flex direction="row" gap="3">
        <Button onClick={() => setSize("md")}>Medium Modal</Button>
        <Button onClick={() => setSize("lg")}>Large Modal</Button>
      </Flex>
    </>
  );
}
