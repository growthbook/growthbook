import { CSSProperties } from "react";
import { PiPulseBold } from "react-icons/pi";
import ShieldBadgeIcon from "@/components/ShieldBadgeIcon";

export default function MonitoredIcon(props: {
  size?: number;
  style?: CSSProperties;
  className?: string;
}) {
  return <ShieldBadgeIcon icon={PiPulseBold} scale={0.58} {...props} />;
}
