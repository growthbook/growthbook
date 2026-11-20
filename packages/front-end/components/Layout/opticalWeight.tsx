import { IconType } from "react-icons";

/**
 * Adds 0.2px at 18px to Phosphor icons whose round outlines read light: 0.2 ×
 * 256 / 18 in the 256-unit grid.
 */
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
