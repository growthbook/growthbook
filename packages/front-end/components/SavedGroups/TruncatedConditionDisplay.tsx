import { ComponentProps, ReactNode } from "react";
import { SavedGroupTargeting, FeaturePrerequisite } from "shared/types/feature";
import { hasTargetingConfigured } from "shared/experiments";
import ConditionDisplay from "@/components/Features/ConditionDisplay";
import ExpandableText, {
  ExpandableTextBody,
  useTextExpanded,
} from "@/components/ExpandableText";

// More than a comment shows, since its rows run taller than lines of text.
const CONDITION_LINES = 12;

interface TruncatedConditionDisplayProps {
  condition?: string;
  savedGroups?: SavedGroupTargeting[];
  prerequisites?: FeaturePrerequisite[];
  prefix?: ReactNode;
}

// A condition cut off past a few lines, opened in place like a long comment.
export default function TruncatedConditionDisplay(
  props: TruncatedConditionDisplayProps,
) {
  // Saved-group-only and prerequisite-only targeting have an empty attribute
  // condition; ConditionDisplay renders them on its own, so only a rule with
  // no targeting at all renders nothing.
  if (!hasTargetingConfigured(props)) {
    return null;
  }

  return (
    <ExpandableText>
      <ExpandableTextBody lines={CONDITION_LINES} linkBelow>
        <ClampedConditionDisplay {...props} />
      </ExpandableTextBody>
    </ExpandableText>
  );
}

// Cut off, it builds only the rows that can show, plus one so it's still cut
// off; the rest wait for it to open.
function ClampedConditionDisplay(
  props: ComponentProps<typeof ConditionDisplay>,
) {
  const expanded = useTextExpanded();
  return (
    <ConditionDisplay
      {...props}
      rowLimit={expanded ? undefined : CONDITION_LINES + 1}
    />
  );
}
