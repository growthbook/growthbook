import { useState, useMemo } from "react";
import { SavedGroupTargeting } from "shared/types/feature";
import ConditionDisplay from "@/components/Features/ConditionDisplay";
import Link from "@/ui/Link";

interface TruncatedConditionDisplayProps {
  condition?: string;
  savedGroups?: SavedGroupTargeting[];
  maxLength?: number;
}

export default function TruncatedConditionDisplay({
  condition,
  savedGroups,
  maxLength = 200,
}: TruncatedConditionDisplayProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  // Check if condition is large
  const isLarge = useMemo(() => {
    if (!condition) return false;
    return condition.length > maxLength;
  }, [condition, maxLength]);

  if (!condition) {
    return null;
  }

  // If expanded or condition is small, show full display
  if (!isLarge || isExpanded) {
    return (
      <>
        <ConditionDisplay condition={condition} savedGroups={savedGroups} />
        {isExpanded && (
          <Link onClick={() => setIsExpanded(false)} mt="1">
            Collapse...
          </Link>
        )}
      </>
    );
  }

  // Show placeholder for large conditions
  return (
    <>
      <div
        style={{ color: "var(--text-color-secondary)", fontStyle: "italic" }}
      >
        Large Condition
      </div>
      <Link onClick={() => setIsExpanded(true)} mt="1">
        Expand...
      </Link>
    </>
  );
}
