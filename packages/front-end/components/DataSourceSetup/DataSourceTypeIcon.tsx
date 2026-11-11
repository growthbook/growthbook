import { ReactElement } from "react";
import { Flex } from "@radix-ui/themes";

const FONT_SIZE = {
  sm: 28,
  lg: 32,
} as const;

export default function DataSourceTypeIcon({
  icon,
  size = "sm",
}: {
  icon: ReactElement;
  size?: keyof typeof FONT_SIZE;
}) {
  return (
    <Flex
      align="center"
      justify="center"
      flexShrink="0"
      aria-hidden="true"
      width={size === "lg" ? "40px" : undefined}
      height={size === "lg" ? "40px" : undefined}
      style={{ fontSize: FONT_SIZE[size], lineHeight: 1 }}
    >
      {icon}
    </Flex>
  );
}
