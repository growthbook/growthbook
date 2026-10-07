import { ReactNode } from "react";
import { PiIdentificationCardBold, PiUserBold } from "react-icons/pi";
import Avatar from "@/ui/Avatar";
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

// The member a request names, for permissions that come from them.
function RequesterAvatar() {
  return (
    <Avatar size="sm" color="gray" variant="soft" radius="small">
      <PiUserBold size={14} />
    </Avatar>
  );
}

// X-Requested-By states of an API key, shown inline before what they affect.

export function RequesterOnlyIcon() {
  return (
    <IconWithTooltip
      icon={<RequesterAvatar />}
      content="Applies only if the requester has it"
    />
  );
}

export function ExtendsWithRequesterIcon() {
  return (
    <IconWithTooltip
      icon={<RequesterAvatar />}
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
