import {
  FaCircleCheck,
  FaCircleExclamation,
  FaCircleHalfStroke,
  FaCircleQuestion,
  FaCircleXmark,
} from "react-icons/fa6";
import { featureStatusColors } from "./FeaturesOverview";

const ICONS = {
  on: { Icon: FaCircleCheck, color: featureStatusColors.on },
  off: { Icon: FaCircleXmark, color: featureStatusColors.offMuted },
  // Half filled: it depends on who the user is.
  varies: { Icon: FaCircleHalfStroke, color: featureStatusColors.warning },
  cycle: { Icon: FaCircleExclamation, color: featureStatusColors.danger },
  unknown: { Icon: FaCircleQuestion, color: featureStatusColors.offMuted },
};

// A feature's state in an environment.
export default function StateIcon({
  state,
  size = 14,
  color,
}: {
  state: keyof typeof ICONS;
  size?: number;
  // Overrides the state's own color.
  color?: string;
}) {
  const { Icon, color: own } = ICONS[state];
  return <Icon size={size} color={color ?? own} />;
}
