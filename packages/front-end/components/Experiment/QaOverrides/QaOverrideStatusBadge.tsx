import { Flex } from "@radix-ui/themes";
import { PiWarningBold } from "react-icons/pi";
import { ExperimentQaOverrideWithStatus } from "shared/types/experiment-qa-override";
import Badge from "@/ui/Badge";
import { Popover } from "@/ui/Popover";
import { QaOverrideWaitingPopoverContent } from "./QaOverrideWaitingMessages";

/**
 * Active, or Not applied with a hover popover that says what's in the way on
 * the Feature Flag and links to where to fix it. A popover rather than a
 * tooltip so the link can be clicked.
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
      contentStyle={{ padding: 0 }}
      trigger={
        <span tabIndex={0} style={{ display: "inline-flex", cursor: "help" }}>
          <Badge
            color="amber"
            variant="soft"
            label={
              <Flex align="center" gap="1" style={{ whiteSpace: "nowrap" }}>
                <PiWarningBold size={12} style={{ flexShrink: 0 }} />
                <span
                  style={{
                    textDecoration: "underline dotted var(--amber-11)",
                    textUnderlineOffset: 3,
                  }}
                >
                  Not applied
                </span>
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
