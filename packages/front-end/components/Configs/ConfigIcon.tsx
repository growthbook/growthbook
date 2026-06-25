import React from "react";
import {
  PiBracketsCurly,
  PiList,
  PiDotsThreeVerticalBold,
} from "react-icons/pi";

// Standard config glyph: curly brackets with a glyph overlaid in the middle —
// a list for base configs (no parent), vertical dots for child configs.
// Inherits `currentColor`.
export default function ConfigIcon({
  isBase = false,
  size = 14,
}: {
  isBase?: boolean;
  size?: number;
}): React.ReactElement {
  const centered: React.CSSProperties = {
    position: "absolute",
    left: "50%",
    top: "50%",
    transform: "translate(-50%, -50%)",
  };
  const Overlay = isBase ? PiList : PiDotsThreeVerticalBold;
  return (
    <span
      style={{
        position: "relative",
        display: "inline-flex",
        width: size,
        height: size,
      }}
    >
      <PiBracketsCurly size={size} style={centered} />
      <Overlay size={Math.round(size * 0.6)} style={centered} />
    </span>
  );
}
