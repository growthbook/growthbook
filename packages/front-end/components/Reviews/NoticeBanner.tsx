import { Box, Flex } from "@radix-ui/themes";
import { ReactNode } from "react";
import Text from "@/ui/Text";

// Shared status banner for the publish flow (divergence/rebase/conflict notices
// and the scheduled-publish card) so they all read identically.
export default function NoticeBanner({
  icon,
  iconColor,
  title,
  body,
  footer,
  action,
}: {
  icon: ReactNode;
  // Radix color scale name (e.g. "red", "amber", "violet").
  iconColor: string;
  title: ReactNode;
  body?: ReactNode;
  // Rendered below the body, unwrapped, for self-styled content (e.g. HelperText).
  footer?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <Flex
      gap="3"
      align="start"
      wrap="wrap"
      p="3"
      mb="3"
      style={{
        background: "var(--color-panel-solid)",
        border: "1px solid var(--gray-a6)",
        borderRadius: "var(--radius-3)",
      }}
    >
      <Flex
        align="center"
        justify="center"
        flexShrink="0"
        style={{
          width: 28,
          height: 28,
          borderRadius: "50%",
          background: `var(--${iconColor}-a3)`,
          color: `var(--${iconColor}-11)`,
          fontSize: 15,
        }}
      >
        {icon}
      </Flex>
      <Box flexGrow="1" style={{ minWidth: 0, flexBasis: 180 }}>
        <Text as="div" size="medium" weight="semibold">
          {title}
        </Text>
        {body && (
          <Text as="div" size="small" color="text-low">
            {body}
          </Text>
        )}
        {footer}
      </Box>
      {action && <Box ml="auto">{action}</Box>}
    </Flex>
  );
}
