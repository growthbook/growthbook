import { CSSProperties } from "react";
import { IconType } from "react-icons";
import { PiShield } from "react-icons/pi";

export default function ShieldBadgeIcon({
  icon: Icon,
  scale,
  size = 20,
  style,
  className,
}: {
  icon: IconType;
  // The glyph's size relative to the shield.
  scale: number;
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
      <Icon
        size={size * scale}
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
