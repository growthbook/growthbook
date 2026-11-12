import { Flex } from "@radix-ui/themes";
import { ExperimentQaOverrideWithStatus } from "shared/types/experiment-qa-override";
import Badge from "@/ui/Badge";
import Text from "@/ui/Text";
import { Popover } from "@/ui/Popover";
import QaOverrideWaitingMessages from "./QaOverrideWaitingMessages";

/**
 * Active, or Waiting with a hover popover naming the Feature Flag that isn't
 * serving the override yet and a link to it. A popover rather than a tooltip
 * so the link can be clicked.
 */
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
      trigger={
        <span
          tabIndex={0}
          style={{
            display: "inline-flex",
            cursor: "help",
            textDecoration: "underline dotted var(--amber-11)",
            textUnderlineOffset: 3,
          }}
        >
          <Badge label="Waiting" color="amber" variant="soft" />
        </span>
      }
      content={
        <Flex direction="column" gap="2" style={{ maxWidth: 320 }}>
          <Text weight="semibold">Waiting for Feature Flag</Text>
          <QaOverrideWaitingMessages
            waitingOn={override.waitingOn}
            environment={override.environment}
          />
        </Flex>
      }
    />
  );
}
