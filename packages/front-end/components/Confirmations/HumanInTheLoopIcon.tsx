import { CSSProperties } from "react";
import { PiShield, PiUserBold } from "react-icons/pi";

// A person on the shield: changes wait for someone to confirm them. Built like
// MonitoredIcon so the two read as a set.
export default function HumanInTheLoopIcon({
  size = 20,
  style,
  className,
}: {
  size?: number;
  style?: CSSProperties;
  className?: string;
}) {
  return (
    <span
      className={className}
      style={{
        position: "relative",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        ...style,
      }}
    >
      <PiShield size={size} />
      <PiUserBold
        size={size * 0.5}
        style={{
          position: "absolute",
          top: "25%",
          left: "50%",
          transform: "translateX(-50%)",
        }}
      />
    </span>
  );
}
