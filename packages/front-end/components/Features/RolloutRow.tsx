import { ReactNode } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { Trans, useLingui } from "@lingui/react/macro";
import { coveragePercentFormatter } from "@/services/utils";
import RuleField from "./RuleField";
import { PlainEntityBadge } from "./EntityBadge";
import styles from "./RolloutRow.module.scss";

// The share of matching units a rule takes, as a bar and a percentage; any
// detail follows "of units".
export default function RolloutRow({
  coverage,
  label,
  children,
}: {
  coverage: number;
  label?: string;
  children?: ReactNode;
}) {
  const { t } = useLingui();
  const labelText = label === undefined ? t`Rollout` : label;
  return (
    <RuleField label={labelText}>
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
            <Trans>of units</Trans>
            {children}
          </span>
        </Flex>
      </Flex>
    </RuleField>
  );
}
