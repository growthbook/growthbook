import { ReactNode } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { coveragePercentFormatter } from "@/services/utils";
import RuleField from "./RuleField";
import { PlainEntityBadge } from "./EntityBadge";
import styles from "./RolloutRow.module.scss";

// The share of matching units a rule takes, as a bar and a percentage; any
// detail follows "of units".
export default function RolloutRow({
  coverage,
  label = "Rollout",
  children,
}: {
  coverage: number;
  label?: string;
  children?: ReactNode;
}) {
  return (
    <RuleField label={label}>
      <Flex gap="3" align="center">
        <Box flexGrow="1" className={styles.track}>
          <Box
            className={styles.fill}
            style={{ width: `${coverage * 100}%` }}
          />
        </Box>
        <Flex align="center" gap="2" wrap="wrap">
          <PlainEntityBadge label={coveragePercentFormatter.format(coverage)} />
          <span>
            of units
            {children}
          </span>
        </Flex>
      </Flex>
    </RuleField>
  );
}
