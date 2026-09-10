import { FC } from "react";
import { Flex } from "@radix-ui/themes";
import UITooltip from "@/ui/Tooltip";
import { ExperimentDot } from "@/components/Experiment/TabbedPage/ExperimentStatusIndicator";
import { StaleStateEntry } from "@/hooks/useFeatureStaleStates";
import {
  FEATURE_HEALTH_STATES,
  getFeatureHealthStates,
} from "@/services/health";

// The feature list's Health column: rules that want cleaning up while the
// flag itself stays (temp rollouts). Staleness has its own Stale column.
const FeatureHealthCell: FC<{ staleData?: StaleStateEntry }> = ({
  staleData,
}) => {
  const states = getFeatureHealthStates(staleData);
  if (!states.length) return null;
  return (
    <Flex direction="column" gap="1" align="start">
      {states.map((state) => (
        <UITooltip
          key={state}
          content={FEATURE_HEALTH_STATES[state].description}
        >
          <Flex gap="1" align="center" style={{ whiteSpace: "nowrap" }}>
            <ExperimentDot color={FEATURE_HEALTH_STATES[state].color} />
            {FEATURE_HEALTH_STATES[state].label}
          </Flex>
        </UITooltip>
      ))}
    </Flex>
  );
};

export default FeatureHealthCell;
