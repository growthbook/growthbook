import { MouseEventHandler, ReactNode } from "react";
import { Flex } from "@radix-ui/themes";
import { PiInfo } from "react-icons/pi";
import Tooltip from "@/ui/Tooltip";

// Keep clicks on the help icon / adornment from toggling the control the label
// is attached to (e.g. a Checkbox).
const guardClick: MouseEventHandler<HTMLSpanElement> = (e) => {
  e.preventDefault();
  e.stopPropagation();
};

export default function LabelWithHelp({
  label,
  help,
  adornment,
}: {
  label: ReactNode;
  help?: string;
  adornment?: ReactNode;
}) {
  if (!help && !adornment) return <>{label}</>;
  return (
    <Flex align="center" gap="1" asChild>
      <span>
        {label}
        {help ? (
          <Tooltip content={help}>
            <span
              tabIndex={0}
              onClick={guardClick}
              aria-label={
                typeof label === "string"
                  ? `More information about ${label}`
                  : "More information"
              }
              style={{ display: "inline-flex" }}
            >
              <PiInfo color="var(--color-text-low)" />
            </span>
          </Tooltip>
        ) : null}
        {adornment ? (
          <span onClick={guardClick} style={{ display: "inline-flex" }}>
            {adornment}
          </span>
        ) : null}
      </span>
    </Flex>
  );
}
