import { getMalformedPrereqConditionError } from "shared/util";
import { PiWarningCircleFill } from "react-icons/pi";
import Badge from "@/ui/Badge";
import Tooltip from "@/ui/Tooltip";

export default function InvalidPrereqConditionBadge({
  condition,
  iconOnly = false,
}: {
  condition: string;
  iconOnly?: boolean;
}) {
  const error = getMalformedPrereqConditionError(condition);
  if (!error) return null;
  return (
    <Tooltip
      content={`Invalid condition: ${error}. SDKs can't evaluate it, so this prerequisite fails. Edit it to fix.`}
    >
      {iconOnly ? (
        <span style={{ display: "flex", color: "var(--red-9)", flexShrink: 0 }}>
          <PiWarningCircleFill size={16} />
        </span>
      ) : (
        <Badge
          label="Invalid condition"
          color="red"
          variant="solid"
          style={{ flexShrink: 0 }}
        />
      )}
    </Tooltip>
  );
}
