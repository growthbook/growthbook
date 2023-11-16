import { FaTriangleExclamation } from "react-icons/fa6";
import { StaleFeatureReason } from "shared/util";
import Tooltip from "@/components/Tooltip/Tooltip";
import styles from "./StaleFeatureIcon.module.scss";

const staleReasonToMessageMap: Record<StaleFeatureReason, string> = {
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
      body={`This feature has been marked stale. ${
        (staleReason && staleReasonToMessageMap[staleReason]) ?? ""
      }`}
    >
      <FaTriangleExclamation onClick={onClick} className={styles.staleIcon} />
    </Tooltip>
  );
}
