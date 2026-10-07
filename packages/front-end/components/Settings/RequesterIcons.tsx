import { ReactNode } from "react";
import { PiIdentificationCardBold, PiUserBold } from "react-icons/pi";
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

// The member a request names, for permissions that come from them. Styled like
// a soft gray avatar, but smaller than Avatar's smallest size.
function RequesterBadge() {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 20,
        height: 20,
        borderRadius: "var(--radius-2)",
        background: "var(--gray-a3)",
        color: "var(--gray-a11)",
      }}
    >
      <PiUserBold size={15} />
    </span>
  );
}

// X-Requested-By states of an API key, shown inline before what they affect.

export function RequesterOnlyIcon() {
  return (
    <IconWithTooltip
      icon={<RequesterBadge />}
      content="Applies only if the requester has it"
    />
  );
}

export function ExtendsWithRequesterIcon() {
  return (
    <IconWithTooltip
      icon={<RequesterBadge />}
      content="Requests that name a member also get that member's permissions"
    />
  );
}

export function RequiresRequesterIcon() {
  return (
    <IconWithTooltip
      icon={<PiIdentificationCardBold />}
      content="Every request must name a requester with X-Requested-By"
    />
  );
}
