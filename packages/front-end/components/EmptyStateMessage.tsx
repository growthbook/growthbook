import { ReactNode } from "react";
import { Flex } from "@radix-ui/themes";
import Text from "@/ui/Text";
import styles from "./EmptyStateMessage.module.scss";

// Where content will be: an icon, what isn't there yet, and what it's for.
export default function EmptyStateMessage({
  icon,
  title,
  description,
}: {
  icon: ReactNode;
  title: ReactNode;
  description: ReactNode;
}) {
  return (
    <Flex direction="column" align="center" gap="3">
      <span className={styles.icon} aria-hidden="true">
        {icon}
      </span>
      <Text size="lg" weight="semibold" align="center">
        {title}
      </Text>
      <Text color="text-mid" align="center">
        {description}
      </Text>
    </Flex>
  );
}
