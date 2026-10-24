import { IconType } from "react-icons";

// Some Phosphor icons' round outlines read lighter than the straighter ones
// at the side nav's 18px. This adds 0.2px to their lines: a stroke in the
// icon's colour around its filled shape, which in the 256-unit grid is
// 0.2 × 256 / 18 ≈ 2.84.
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
