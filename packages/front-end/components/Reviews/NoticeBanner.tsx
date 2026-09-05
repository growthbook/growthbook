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
  subtle = false,
}: {
  icon: ReactNode;
  // Radix color scale name (e.g. "red", "amber", "violet").
  iconColor: string;
  title: ReactNode;
  body?: ReactNode;
  // Rendered below the body, unwrapped, for self-styled content (e.g. HelperText).
  footer?: ReactNode;
  action?: ReactNode;
  // Drops the card chrome, for a notice sharing space with other content
  // rather than standing alone in a column.
  subtle?: boolean;
}) {
  return (
    <Flex
      gap="3"
      align={subtle ? "center" : "start"}
      wrap="wrap"
      p={subtle ? "0" : "3"}
      mb={subtle ? "0" : "3"}
      style={
        subtle
          ? undefined
          : {
              background: "var(--color-panel-solid)",
              border: "1px solid var(--gray-a6)",
              borderRadius: "var(--radius-3)",
            }
      }
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
        <Text as="div" size="md" weight={subtle ? "regular" : "semibold"}>
          {title}
        </Text>
        {body && (
          <Text as="div" size="sm" color="text-low">
            {body}
          </Text>
        )}
        {footer}
      </Box>
      {action && <Box ml="auto">{action}</Box>}
    </Flex>
  );
}
