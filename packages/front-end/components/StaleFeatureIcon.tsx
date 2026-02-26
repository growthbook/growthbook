import { StaleFeatureReason } from "shared/util";
import { BsStopwatch } from "react-icons/bs";
import Tooltip from "@/components/Tooltip/Tooltip";
import styles from "./StaleFeatureIcon.module.scss";

const staleReasonToMessageMap: Record<StaleFeatureReason, string> = {
  "never-stale": "Stale detection is disabled for this feature.",
  "no-rules": "No rules have been defined for this feature.",
  "rules-one-sided": "All rules are one-sided.",
  error: "An error occurred while evaluating the staleness of this feature.",
};

export default function StaleFeatureIcon({
  staleReason,
  onClick,
}: {
  staleReason: StaleFeatureReason | undefined;
  onClick: () => void;
}) {
  return (
    <Tooltip
      popperClassName="text-left"
      body={`This feature has been marked stale. ${
        (staleReason && staleReasonToMessageMap[staleReason]) ?? ""
      }`}
    >
      <BsStopwatch size={18} onClick={onClick} className={styles.staleIcon} />
    </Tooltip>
  );
}
