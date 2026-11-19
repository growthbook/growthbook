import { Flex } from "@radix-ui/themes";
import { PiWarningBold } from "react-icons/pi";
import { ExperimentQaOverrideWithStatus } from "shared/types/experiment-qa-override";
import Badge from "@/ui/Badge";
import { Popover } from "@/ui/Popover";
import { QaOverrideWaitingPopoverContent } from "./QaOverrideWaitingMessages";
import styles from "./QaOverrides.module.scss";

export default function QaOverrideStatusBadge({
  override,
}: {
  override: Pick<
    ExperimentQaOverrideWithStatus,
    "status" | "waitingOn" | "environment"
  >;
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
        <span tabIndex={0} className={styles.help}>
          <Badge
            color="amber"
            variant="soft"
            label={
              <Flex align="center" gap="1" style={{ whiteSpace: "nowrap" }}>
                <PiWarningBold size={12} style={{ flexShrink: 0 }} />
                <span className={styles.dotted}>Not applied</span>
              </Flex>
            }
          />
        </span>
      }
      content={
        <QaOverrideWaitingPopoverContent
          waitingOn={override.waitingOn}
          environment={override.environment}
        />
      }
    />
  );
}
