import { IconType } from "react-icons";

// Optical correction for the side nav's icons (set in review): some icons'
// lines 0.2px thicker at the rail's 18px (tried 0.1px), as their round
// outlines read lighter than the straighter ones. Phosphor's icons are
// filled shapes, so the extra weight is a stroke in the same colour around
// the shape, half on each side; in the icons' 256-unit grid, 0.2px at 18px
// is 0.2 × 256 / 18 ≈ 2.84.
export const OPTICAL_STROKE = 2.84;

export function withOpticalWeight(Icon: IconType): IconType {
  return function OpticalWeightIcon(props) {
    return (
      <Icon
        {...props}
        stroke="currentColor"
        strokeWidth={OPTICAL_STROKE}
        strokeLinejoin="round"
      />
    );
  };
}
