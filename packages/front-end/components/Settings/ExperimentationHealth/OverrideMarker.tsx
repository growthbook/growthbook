import React from "react";
import { PiArrowCounterClockwise } from "react-icons/pi";
import Tooltip from "@/ui/Tooltip";
import Link from "@/ui/Link";

// Marks a Project setting that overrides the organization default. Paired
// with OrgDefaultLink so the overridden state isn't shown by color alone.
export function OverrideDot() {
  return (
    <Tooltip content="Customized for this Project">
      <span
        role="img"
        aria-label="Customized for this Project"
        style={{
          display: "inline-block",
          flexShrink: 0,
          width: 7,
          height: 7,
          borderRadius: "50%",
          background: "var(--violet-9)",
        }}
      />
    </Tooltip>
  );
}

export function OrgDefaultLink({
  value,
  onReset,
}: {
  value: string;
  onReset: () => void;
}) {
  return (
    <Link
      onClick={onReset}
      size="sm"
      style={{ whiteSpace: "nowrap" }}
      aria-label={`Reset to the organization default, ${value}`}
    >
      Org default: {value}{" "}
      <PiArrowCounterClockwise style={{ verticalAlign: "-1px" }} />
    </Link>
  );
}
