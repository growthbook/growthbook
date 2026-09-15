import { ReactNode } from "react";
import { Box, Flex } from "@radix-ui/themes";
import Text from "@/ui/Text";

interface Props {
  label: string;
  // Content on the right of the label row, e.g. a DashboardFilterInheritTag or a
  // Clear all link.
  accessory?: ReactNode;
  children: ReactNode;
}

// A labeled field row in a dashboard block's settings form. Fields that can follow
// a dashboard filter stay editable while inheriting, so nothing here disables them.
export default function SidebarSettingField({
  label,
  accessory,
  children,
}: Props) {
  return (
    <Box>
      <Flex justify="between" align="center" gap="3" mb="2">
        <Text weight="semibold">{label}</Text>
        {accessory}
      </Flex>
      {children}
    </Box>
  );
}
