import { FC, ReactNode } from "react";
import { Box, Flex } from "@radix-ui/themes";
import Text from "@/ui/Text";

const TextDivider: FC<{
  children: ReactNode;
  width?: number | string;
  className?: string;
}> = ({ children, width = "100%", className }) => {
  return (
    <Flex justify="center" width="100%" className={className}>
      <Flex align="center" style={{ width }}>
        <Box
          flexGrow="1"
          height="1px"
          mx="5"
          style={{ backgroundColor: "var(--border-color-200)" }}
        />
        <Text color="text-low" align="center" size="small">
          {children}
        </Text>
        <Box
          flexGrow="1"
          height="1px"
          mx="5"
          style={{ backgroundColor: "var(--border-color-200)" }}
        />
      </Flex>
    </Flex>
  );
};

export default TextDivider;
