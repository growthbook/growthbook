import { ReactNode } from "react";
import { Flex } from "@radix-ui/themes";
import Text from "@/ui/Text";
import styles from "./ValueGroup.module.scss";

// The values one condition or saved-group operation applies to, in
// parentheses when there's more than one.
export default function ValueGroup({
  parens,
  children,
}: {
  parens: boolean;
  children: ReactNode;
}) {
  return (
    <Flex wrap="wrap" align="center" gap="1">
      {parens ? (
        <span className={styles.open}>
          <Text weight="medium">(</Text>
        </span>
      ) : null}
      {children}
      {parens ? (
        <span className={styles.close}>
          <Text weight="medium">)</Text>
        </span>
      ) : null}
    </Flex>
  );
}
