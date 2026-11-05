import { useState, useMemo, ReactNode } from "react";
import { SavedGroupTargeting, FeaturePrerequisite } from "shared/types/feature";
import { hasTargetingConfigured } from "shared/experiments";
import ConditionDisplay from "@/components/Features/ConditionDisplay";
import Link from "@/ui/Link";
import Text from "@/ui/Text";

interface TruncatedConditionDisplayProps {
  condition?: string;
  savedGroups?: SavedGroupTargeting[];
  prerequisites?: FeaturePrerequisite[];
  maxLength?: number;
  prefix?: ReactNode;
}

export default function TruncatedConditionDisplay({
  condition,
  savedGroups,
  prerequisites,
  maxLength = 200,
  prefix,
}: TruncatedConditionDisplayProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  // Check if condition is large
  const isLarge = useMemo(() => {
    if (!condition) return false;
    return condition.length > maxLength;
  }, [condition, maxLength]);

  // Saved-group-only and prerequisite-only targeting have an empty attribute
  // condition; ConditionDisplay renders them on its own, so only a rule with
  // no targeting at all renders nothing.
  if (!hasTargetingConfigured({ condition, savedGroups, prerequisites })) {
    return null;
  }

  // If expanded or condition is small, show full display
  if (!isLarge || isExpanded) {
    return (
      <>
        <ConditionDisplay
          condition={condition}
          savedGroups={savedGroups}
          prerequisites={prerequisites}
          prefix={prefix}
        />
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
      <div>
        <Text color="text-mid" weight="semibold">
          <em>Large Condition</em>
        </Text>
      </div>
      <Link onClick={() => setIsExpanded(true)} mt="1">
        Expand...
      </Link>
    </>
  );
}
