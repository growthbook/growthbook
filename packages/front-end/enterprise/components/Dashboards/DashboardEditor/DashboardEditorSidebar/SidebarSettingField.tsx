import { ReactNode } from "react";
import { Box, Flex } from "@radix-ui/themes";
import Text from "@/ui/Text";

interface Props {
  label: string;
  // Optional extra control rendered on the right of the label row (e.g. a
  // Compare toggle).
  accessory?: ReactNode;
  children: ReactNode;
}

// A labeled field row in a dashboard block's settings form. The field control
// (children) owns its own disabled state; when the block follows the dashboard's
// experiment filters the control is shown populated with the dashboard value and
// disabled, driven by the single toggle at the top of the form.
export default function SidebarSettingField({
  label,
  accessory,
  children,
}: Props) {
  return (
    <Box>
      <Flex justify="between" align="center" mb="2">
        <Text weight="semibold">{label}</Text>
        {accessory}
      </Flex>
      {children}
    </Box>
  );
}
