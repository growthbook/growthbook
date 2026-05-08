import { CSSProperties } from "react";
import { PiShield, PiPulseBold } from "react-icons/pi";

export default function MonitoredIcon({
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
      <PiPulseBold
        size={size * 0.58}
        style={{
          position: "absolute",
          top: "22%",
          left: "50%",
          transform: "translateX(-50%)",
        }}
      />
    </span>
  );
}
