import { FC } from "react";
import { Box, Flex, Text } from "@radix-ui/themes";

const EmptyState: FC<{
  title: string;
  description: string;
  leftButton: React.ReactNode | null;
  rightButton: React.ReactNode | null;
}> = ({ title, description, leftButton, rightButton }) => {
  return (
    <Box p="60px" pb="70px" className={`box text-center`}>
      <Flex direction="column" align="center" gap="8px">
        <Text
          size="6"
          style={{ fontWeight: 500, color: "var(--color-text-high)" }}
        >
          {title}
        </Text>
        <Text size="3" style={{ color: "var(--color-text-mid)" }}>
          {description}
        </Text>

        <Flex justify="center" gap="5" pt="4">
          {leftButton} {rightButton}
        </Flex>
      </Flex>
    </Box>
  );
};

export default EmptyState;
