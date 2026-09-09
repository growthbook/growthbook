import { Flex } from "@radix-ui/themes";
import { ReactNode } from "react";
import Avatar from "@/ui/Avatar";
import Text from "@/ui/Text";
import { ICON_PROPERTIES } from "@/components/Experiment/LinkedChanges/constants";

// The shared Linked Change icon, so a Feature Flag looks the same everywhere.
const { component: FlagIcon, radixColor: FLAG_COLOR } =
  ICON_PROPERTIES["feature-flag"];

// Not a link: the flag is edited from the experiment, not from its own page.
export function ManagedFlagName({
  featureId,
  children,
}: {
  featureId: string;
  children?: ReactNode;
}) {
  return (
    <Flex align="center" gap="3">
      <Avatar radius="small" color={FLAG_COLOR} size="sm" variant="soft">
        <FlagIcon />
      </Avatar>
      <Text weight="medium">{featureId}</Text>
      {children}
    </Flex>
  );
}
