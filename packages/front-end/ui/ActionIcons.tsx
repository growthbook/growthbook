import {
  PiCheck,
  PiCopy,
  PiCornersInBold,
  PiCornersOutBold,
} from "react-icons/pi";

// Icons for small copy and fullscreen buttons, scaled up since they read faint
// at these sizes; the thin fullscreen corners are bold too. Scaling keeps each
// button its size.
const SCALED = { transform: "scale(1.15)" };

export function CopyIcon({
  copied = false,
  size,
}: {
  copied?: boolean;
  size?: number;
}) {
  const Icon = copied ? PiCheck : PiCopy;
  return <Icon size={size} style={SCALED} />;
}

export function FullscreenIcon({
  exit = false,
  size,
}: {
  exit?: boolean;
  size?: number;
}) {
  const Icon = exit ? PiCornersInBold : PiCornersOutBold;
  return <Icon size={size} style={SCALED} />;
}
