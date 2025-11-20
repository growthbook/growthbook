import { Flex } from "@radix-ui/themes";
import { useState } from "react";
import Dialog, { Size } from "./Dialog";
import Button from "./Button";

export default function DialogStories() {
  const [size, setSize] = useState<Size | null>(null);
  return (
    <>
      <Dialog
        open={!!size}
        header="GrowthBook Modal"
        subheader="This is an example modal with a subheading"
        size={size ?? undefined}
        submit={() => {
          throw new Error("This is a test error");
        }}
        close={() => setSize(null)}
      >
        <p>This is a medium modal</p>
      </Dialog>
      <Flex direction="row" gap="3">
        <Button onClick={() => setSize("md")}>Medium Modal</Button>
        <Button onClick={() => setSize("lg")}>Large Modal</Button>
      </Flex>
    </>
  );
}
