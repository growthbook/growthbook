import { FC, ReactNode } from "react";
import { Box, Flex, Text } from "@radix-ui/themes";

const EmptyState: FC<{
  title: string;
  description: string;
  leftButton: React.ReactNode | null;
  rightButton: React.ReactNode | null;
  image?: string;
  // Shown above the title, 12px clear of it. Optional; none by default.
  icon?: ReactNode;
}> = ({ title, description, leftButton, rightButton, image, icon }) => {
  return (
    <Box p="60px" pb="70px" className={`box text-center`}>
      <Flex direction="column" align="center" gap="8px">
        {/* 4px more below it than the column's 8px gap, so 12px. */}
        {icon ? <Flex style={{ marginBottom: 4 }}>{icon}</Flex> : null}
        <Text
          size="6"
          style={{ fontWeight: 500, color: "var(--color-text-high)" }}
        >
          {title}
        </Text>
        <Text size="3" style={{ color: "var(--color-text-mid)" }}>
          {description}
        </Text>

        {(leftButton || rightButton) && (
          <Flex justify="center" gap="5" pt="4">
            {leftButton} {rightButton}
          </Flex>
        )}

        {image && (
          <div className="mt-4">
            <img
              src={image}
              alt={title}
              style={{ width: "100%", maxWidth: "740px", height: "auto" }}
            />
          </div>
        )}
      </Flex>
    </Box>
  );
};

export default EmptyState;
