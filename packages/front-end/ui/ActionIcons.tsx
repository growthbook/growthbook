import {
  PiCheck,
  PiCopy,
  PiCornersInBold,
  PiCornersOutBold,
  PiMagicWandFill,
  PiPencilSimple,
} from "react-icons/pi";
import { Size } from "@/ui/sizes";

// Icons for small copy, fullscreen, edit and format buttons, scaled up since they read faint
// at these sizes; the thin fullscreen corners are bold too. Scaling keeps each
// button its size.
const SCALED = { transform: "scale(1.15)" };
// Unset, an icon follows the text around it.
const ICON_SIZES = { sm: 12 };
type IconSize = Size<"sm">;

export function CopyIcon({
  copied = false,
  size,
}: {
  copied?: boolean;
  size?: IconSize;
}) {
  const Icon = copied ? PiCheck : PiCopy;
  return <Icon size={size && ICON_SIZES[size]} style={SCALED} />;
}

export function FullscreenIcon({
  exit = false,
  size,
}: {
  exit?: boolean;
  size?: IconSize;
}) {
  const Icon = exit ? PiCornersInBold : PiCornersOutBold;
  return <Icon size={size && ICON_SIZES[size]} style={SCALED} />;
}

export function FormatJsonIcon({ size }: { size?: IconSize }) {
  return <PiMagicWandFill size={size && ICON_SIZES[size]} style={SCALED} />;
}

export function EditIcon({ size }: { size?: IconSize }) {
  return <PiPencilSimple size={size && ICON_SIZES[size]} style={SCALED} />;
}
