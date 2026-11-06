import { ReactNode } from "react";
import { Box, Flex } from "@radix-ui/themes";
import Text from "@/ui/Text";
import { coveragePercentFormatter } from "@/services/utils";
import { PlainEntityBadge } from "./EntityBadge";
import styles from "./RolloutRow.module.scss";

// The share of matching units a rule takes, as a bar and a percentage; any
// detail follows "of units".
export default function RolloutRow({
  coverage,
  children,
}: {
  coverage: number;
  children?: ReactNode;
}) {
  return (
    <Flex gap="3" align="center" mb="3">
      <Text weight="medium">ROLLOUT</Text>
      <Box flexGrow="1" className={styles.track}>
        <Box className={styles.fill} style={{ width: `${coverage * 100}%` }} />
      </Box>
      <Flex align="center" gap="2" wrap="wrap">
        <PlainEntityBadge label={coveragePercentFormatter.format(coverage)} />
        <span>
          of units
          {children}
        </span>
      </Flex>
    </Flex>
  );
}
