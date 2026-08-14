import { FC } from "react";
import { Box, Flex, Text } from "@radix-ui/themes";
import { useTx } from "@/services/i18n";

const EmptyState: FC<{
  title: string;
  description: string;
  leftButton: React.ReactNode | null;
  rightButton: React.ReactNode | null;
  image?: string;
}> = ({ title, description, leftButton, rightButton, image }) => {
  const tx = useTx();
  return (
    <Box p="60px" pb="70px" className={`box text-center`}>
      <Flex direction="column" align="center" gap="8px">
        <Text
          size="6"
          style={{ fontWeight: 500, color: "var(--color-text-high)" }}
        >
          {tx(title)}
        </Text>
        <Text size="3" style={{ color: "var(--color-text-mid)" }}>
          {tx(description)}
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
              alt={String(tx(title))}
              style={{ width: "100%", maxWidth: "740px", height: "auto" }}
            />
          </div>
        )}
      </Flex>
    </Box>
  );
};

export default EmptyState;
