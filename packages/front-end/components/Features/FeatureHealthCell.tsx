import { FC } from "react";
import { Flex } from "@radix-ui/themes";
import { FeatureHealthEntry } from "shared/util";
import { Popover } from "@/ui/Popover";
import Badge from "@/ui/Badge";
import { ExperimentDot } from "@/components/Experiment/TabbedPage/ExperimentStatusIndicator";
import { FeatureHealthStateEntry } from "@/hooks/useFeatureHealthStates";
import {
  describeFeatureHealthEntry,
  entryMatchesHealthFilter,
  FEATURE_HEALTH_STATES,
  getFeatureHealthEntries,
} from "@/services/health";

// Rendered only while the popover is open.
const FeatureHealthDetails: FC<{ entries: FeatureHealthEntry[] }> = ({
  entries,
}) => (
  <Flex direction="column" gap="2" style={{ maxWidth: 360 }}>
    {entries.map((entry) => (
      <Flex key={entry.signal} direction="column" gap="0">
        <Flex gap="1" align="center">
          <ExperimentDot color={FEATURE_HEALTH_STATES[entry.signal].color} />
          <strong>
            {FEATURE_HEALTH_STATES[entry.signal].label}
            {entry.count > 1 ? ` (${entry.count})` : ""}
          </strong>
        </Flex>
        <span>{describeFeatureHealthEntry(entry)}</span>
      </Flex>
    ))}
  </Flex>
);

const FeatureHealthCell: FC<{
  staleData?: FeatureHealthStateEntry;
  healthFilter?: string[];
}> = ({ staleData, healthFilter = [] }) => {
  const entries = getFeatureHealthEntries(staleData);
  if (!entries.length) return null;
  const shown = entries.filter(
    (entry, i) => i === 0 || entryMatchesHealthFilter(entry, healthFilter),
  );
  // Repeats of a shown signal count toward the chip too.
  const hidden =
    entries.reduce((sum, entry) => sum + entry.count, 0) - shown.length;

  return (
    <Popover
      openOnHover
      side="left"
      align="center"
      showArrow
      content={<FeatureHealthDetails entries={entries} />}
      trigger={
        <Flex direction="column" gap="1" align="start">
          {shown.map((entry, i) => (
            <Flex
              key={entry.signal}
              gap="2"
              align="center"
              style={{ whiteSpace: "nowrap" }}
            >
              <Flex gap="1" align="center">
                <ExperimentDot
                  color={FEATURE_HEALTH_STATES[entry.signal].color}
                />
                {FEATURE_HEALTH_STATES[entry.signal].label}
              </Flex>
              {i === shown.length - 1 && hidden > 0 && (
                <Badge
                  label={`+${hidden}`}
                  color="gray"
                  variant="soft"
                  radius="full"
                  size="xs"
                />
              )}
            </Flex>
          ))}
        </Flex>
      }
    />
  );
};

export default FeatureHealthCell;
