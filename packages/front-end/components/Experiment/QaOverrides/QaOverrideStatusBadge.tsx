import { Flex } from "@radix-ui/themes";
import { ExperimentQaOverrideWithStatus } from "shared/types/experiment-qa-override";
import Badge from "@/ui/Badge";
import Link from "@/ui/Link";
import { Popover } from "@/ui/Popover";
import { RadixStatusIcon } from "@/ui/HelperText";
import { QaOverrideProblemsPopoverContent } from "./QaOverrideWaitingMessages";
import styles from "./QaOverrides.module.scss";

export default function QaOverrideStatusBadge({
  override,
  onEdit,
}: {
  override: Pick<
    ExperimentQaOverrideWithStatus,
    "status" | "waitingOn" | "invalidReasons" | "environment"
  >;
  // Offered for problems only an edit can fix. Omit when the user can't edit.
  onEdit?: () => void;
}) {
  if (override.status === "active") {
    return <Badge label="Active" color="green" variant="soft" />;
  }
  return (
    <Popover
      openOnHover
      side="top"
      align="start"
      contentStyle={{ padding: 0 }}
      trigger={
        // A real button, so Enter and Space open it from the keyboard.
        <Link color="inherit" underline="none" className={styles.help}>
          <Badge
            color="amber"
            variant="soft"
            label={
              <Flex align="center" gap="1" style={{ whiteSpace: "nowrap" }}>
                <RadixStatusIcon status="warning" size="sm" />
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
