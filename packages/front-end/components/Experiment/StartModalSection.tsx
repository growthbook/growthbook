import { ReactNode } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { MarginProps } from "@radix-ui/themes/dist/esm/props/margin.props.js";
import Text from "@/ui/Text";

/** A block of a start modal: an optional title over the panel that holds it. */
export default function StartModalSection({
  title,
  icon,
  children,
  ...margin
}: {
  title?: string;
  icon?: ReactNode;
  children: ReactNode;
} & MarginProps) {
  return (
    <Box {...margin}>
      {title ? (
        <Flex align="center" gap="1" mb="3">
          {icon}
          <Text size="lg" weight="semibold" color="text-high">
            {title}
          </Text>
        </Flex>
      ) : null}
      <Box
        style={{
          backgroundColor: "var(--slate-2)",
          padding: "20px",
          borderRadius: "var(--radius-3)",
        }}
      >
        {children}
      </Box>
    </Box>
  );
}
