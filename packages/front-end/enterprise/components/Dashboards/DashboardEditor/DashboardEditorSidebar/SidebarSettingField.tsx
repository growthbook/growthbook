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
// (children) owns its own disabled state; when the field follows the dashboard's
// corresponding filter (via the per-field toggle in `accessory`) the control is
// shown populated with the dashboard value and disabled.
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
