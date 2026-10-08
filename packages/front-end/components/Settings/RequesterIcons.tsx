import { ReactNode } from "react";
import { PiIdentificationCardBold } from "react-icons/pi";
import Tooltip from "@/ui/Tooltip";

function IconWithTooltip({
  icon,
  content,
}: {
  icon: ReactNode;
  content: string;
}) {
  return (
    <Tooltip content={content}>
      <span
        style={{
          display: "inline-flex",
          marginRight: 4,
          verticalAlign: "middle",
          color: "var(--color-text-low)",
        }}
      >
        {icon}
      </span>
    </Tooltip>
  );
}

export function RequiresRequesterIcon() {
  return (
    <IconWithTooltip
      icon={<PiIdentificationCardBold />}
      content="Every request must name a requester with X-GrowthBook-Requested-By"
    />
  );
}
