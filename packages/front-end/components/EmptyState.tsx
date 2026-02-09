import { FC } from "react";
import { Box, Flex } from "@radix-ui/themes";
import Text from "@/ui/Text";

const EmptyState: FC<{
  title: string;
  description: string;
  leftButton: React.ReactNode | null;
  rightButton: React.ReactNode | null;
  image?: string;
}> = ({ title, description, leftButton, rightButton, image }) => {
  return (
    <Box p="60px" pb="70px" className={`box text-center`}>
      <Flex direction="column" align="center" gap="8px">
        <Text
          size="large"
          style={{ fontWeight: 500, color: "var(--color-text-high)" }}
        >
          {title}
        </Text>
        <Text size="large" color="text-mid">
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
