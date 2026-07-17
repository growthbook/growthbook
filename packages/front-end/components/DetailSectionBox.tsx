import { ReactNode } from "react";
import { Box, Flex } from "@radix-ui/themes";
import type { BoxProps } from "@radix-ui/themes";
import Button from "@/ui/Button";
import Frame from "@/ui/Frame";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";

export function DetailSectionBox({
  title,
  onEdit,
  editLabel = "Edit",
  children,
}: {
  title: string;
  onEdit?: (() => void) | null;
  editLabel?: string;
  children: ReactNode;
}) {
  return (
    <Frame>
      <Flex align="center" justify="between" mb="4">
        <Heading as="h4" size="small" mb="0">
          {title}
        </Heading>
        {onEdit ? (
          <Button variant="ghost" onClick={onEdit}>
            {editLabel}
          </Button>
        ) : null}
      </Flex>
      {children}
    </Frame>
  );
}

/**
 * A labeled field intended to sit inside a Radix `<Grid>`. Each column
 * occupies a single grid cell by default; pass `gridColumn` (e.g. `"span 2"`)
 * to span multiple cells.
 */
export function DetailSectionColumn({
  label,
  children,
  gridColumn,
  className,
}: {
  label: ReactNode;
  children: ReactNode;
  gridColumn?: BoxProps["gridColumn"];
  className?: string;
}) {
  return (
    <Box gridColumn={gridColumn} className={className}>
      <Text as="div" weight="semibold" mb="1">
        {label}
      </Text>
      <Box>{children}</Box>
    </Box>
  );
}
