import { Box, Flex } from "@radix-ui/themes";
import { ReactNode } from "react";
import Text from "@/ui/Text";

// GitHub-style banner ("This branch is out-of-date with the base branch"):
// neutral panel, tinted icon disk, bold title with a muted body, and a
// right-aligned secondary action that wraps below in narrow columns. Shared by
// the publish-flow status blocks (divergence/rebase/conflict notices and the
// scheduled-publish status card) so they all read identically.
export default function NoticeBanner({
  icon,
  iconColor,
  title,
  body,
  footer,
  action,
}: {
  icon: ReactNode;
  // Radix color scale name (e.g. "red", "amber", "violet", "gray").
  iconColor: string;
  title: ReactNode;
  body?: ReactNode;
  // Rendered below the muted body, unwrapped, for content that styles itself
  // (e.g. a HelperText callout).
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
