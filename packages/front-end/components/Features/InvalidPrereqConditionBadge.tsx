import { getMalformedPrereqConditionError } from "shared/util";
import { PiWarningCircleFill } from "react-icons/pi";
import { IconButton } from "@radix-ui/themes";
import { useLingui } from "@lingui/react/macro";
import Badge from "@/ui/Badge";
import Tooltip from "@/ui/Tooltip";

export default function InvalidPrereqConditionBadge({
  condition,
  iconOnly = false,
}: {
  condition: string;
  iconOnly?: boolean;
}) {
  const { t } = useLingui();
  const error = getMalformedPrereqConditionError(condition);
  if (!error) return null;
  const message = t`Invalid condition: ${error}. SDKs can't evaluate it, so this prerequisite fails. Edit it to fix.`;
  return (
    <Tooltip content={message}>
      {iconOnly ? (
        <IconButton
          variant="ghost"
          color="red"
          size="1"
          aria-label={message}
          style={{ flexShrink: 0 }}
        >
          <PiWarningCircleFill size={16} aria-hidden />
        </IconButton>
      ) : (
        <Badge
          label={t`Invalid condition`}
          color="red"
          variant="solid"
          style={{ flexShrink: 0 }}
        />
      )}
    </Tooltip>
  );
}
