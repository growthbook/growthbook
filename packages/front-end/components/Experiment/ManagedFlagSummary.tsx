import { Box, Flex } from "@radix-ui/themes";
import { PiInfo } from "react-icons/pi";
import { ReactNode } from "react";
import Heading from "@/ui/Heading";
import Avatar from "@/ui/Avatar";
import Text from "@/ui/Text";
import Tooltip from "@/ui/Tooltip";
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

// Names the flag an experiment owns, under its own header.
export default function ManagedFlagSummary({
  featureId,
  tooltip,
  children,
}: {
  featureId: string;
  tooltip?: string;
  children?: ReactNode;
}) {
  return (
    <Box>
      <Flex align="center" gap="1" mb="2">
        <Heading color="text-high" as="h4" size="sm" mb="0">
          Managed Feature Flag
        </Heading>
        {tooltip && (
          <Tooltip content={tooltip} side="top">
            <Flex align="center" style={{ color: "var(--color-text-low)" }}>
              <PiInfo />
            </Flex>
          </Tooltip>
        )}
      </Flex>
      <ManagedFlagName featureId={featureId}>{children}</ManagedFlagName>
    </Box>
  );
}
