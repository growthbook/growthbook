import { ReactNode } from "react";
import { Box } from "@radix-ui/themes";
import Collapse, { CollapseTrigger } from "@/ui/Collapse";
import Text from "@/ui/Text";

/** The collapsed "Advanced" section under a form's main fields. */
export default function AdvancedSection({
  open,
  setOpen,
  children,
}: {
  open: boolean;
  setOpen: (open: boolean) => void;
  children: ReactNode;
}) {
  return (
    <>
      <CollapseTrigger open={open} onOpenChange={setOpen} caret="start">
        <Text weight="medium" color="text-high">
          Advanced
        </Text>
      </CollapseTrigger>
      <Collapse open={open}>
        <Box pt="3">{children}</Box>
      </Collapse>
    </>
  );
}
