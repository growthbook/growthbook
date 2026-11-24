import { Flex } from "@radix-ui/themes";
import { ExperimentQaOverrideWithStatus } from "shared/types/experiment-qa-override";
import Badge from "@/ui/Badge";
import Link from "@/ui/Link";
import { Popover } from "@/ui/Popover";
import { getRadixColor, RadixStatusIcon } from "@/ui/HelperText";
import {
  QaOverrideProblemsPopoverContent,
  qaOverrideProblemStatus,
} from "./QaOverrideProblems";
import styles from "./QaOverrides.module.scss";

export default function QaOverrideStatusBadge({
  override,
  onEdit,
}: {
  override: Pick<
    ExperimentQaOverrideWithStatus,
    "status" | "waitingOn" | "invalidReasons" | "environment"
  >;
  // Omit when the user can't edit.
  onEdit?: () => void;
}) {
  if (override.status === "active") {
    return <Badge label="Active" color="green" variant="soft" />;
  }
  const status = qaOverrideProblemStatus(override);
  return (
    <Popover
      openOnHover
      side="top"
      align="start"
      contentStyle={{ padding: 0 }}
      trigger={
        // A real button, so Enter and Space open it.
        <Link color="inherit" underline="none" className={styles.help}>
          <Badge
            color={getRadixColor(status)}
            variant="soft"
            label={
              <Flex align="center" gap="1" style={{ whiteSpace: "nowrap" }}>
                <RadixStatusIcon status={status} size="sm" />
                <span className={styles.dotted}>Not applied</span>
              </Flex>
            }
          />
        </Link>
      }
      content={
        <QaOverrideProblemsPopoverContent override={override} onEdit={onEdit} />
      }
    />
  );
}
