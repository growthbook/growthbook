import { CSSProperties } from "react";
import { PiUserBold } from "react-icons/pi";
import ShieldBadgeIcon from "@/components/ShieldBadgeIcon";

export default function HumanInTheLoopIcon(props: {
  size?: number;
  style?: CSSProperties;
  className?: string;
}) {
  return <ShieldBadgeIcon icon={PiUserBold} scale={0.5} {...props} />;
}
