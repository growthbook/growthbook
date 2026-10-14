import { CSSProperties } from "react";
import { PiUserBold } from "react-icons/pi";
import ShieldBadgeIcon from "@/components/ShieldBadgeIcon";

// A person on the shield: changes wait for someone to confirm them.
export default function HumanInTheLoopIcon(props: {
  size?: number;
  style?: CSSProperties;
  className?: string;
}) {
  return <ShieldBadgeIcon icon={PiUserBold} scale={0.5} {...props} />;
}
