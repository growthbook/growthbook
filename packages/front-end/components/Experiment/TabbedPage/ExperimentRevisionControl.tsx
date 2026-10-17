import { useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { PiCaretDownBold } from "react-icons/pi";
import {
  ExperimentInterfaceStringDates,
  LinkedFeatureInfo,
} from "shared/types/experiment";
import { isManagedByExperiment } from "shared/util";
import Text from "@/ui/Text";
import { DropdownMenu, DropdownMenuItem } from "@/ui/DropdownMenu";
import StatusDot from "@/components/Experiment/StatusDot";
import { hasUnpublishedChanges } from "@/components/Experiment/LinkedChanges/linkedFeatureDiff";
import { useLiveView } from "./ExperimentEdits";
import { valuesAreSetup } from "./useExperimentEditing";
import { getValuesDraftStage, ValuesDraftStage } from "./valuesStatus";

// Where the unpublished changes stand, in the viewer's terms.
const DRAFT_STAGE_LABELS: Record<ValuesDraftStage, string> = {
  conflict: "Out of date with live",
  stale: "Out of date with live",
  unreviewed: "Not yet published",
  unsent: "Not yet sent for review",
  "pending-review": "Awaiting review",
  "changes-requested": "Changes requested",
  "short-of-approval": "More approvals needed",
  approved: "Approved, not yet published",
};

/**
 * PROTOTYPE: which version the page shows, once there's a choice: a running
 * experiment whose Feature Flags have unpublished changes. Before launch
 * nothing is live.
 */
export default function ExperimentRevisionControl({
  experiment,
  linkedFeatures,
}: {
  experiment: ExperimentInterfaceStringDates;
  linkedFeatures: LinkedFeatureInfo[];
}) {
  const { live, setLive } = useLiveView();
  const [open, setOpen] = useState(false);
  const changed = linkedFeatures.filter(hasUnpublishedChanges);
  if (valuesAreSetup(experiment) || !changed.length) return null;
  // The Values flag's review is the experiment's; any other flag's is its own.
  const managedDraft =
    changed.length === 1 &&
    isManagedByExperiment(changed[0].feature, experiment.id)
      ? changed[0].pendingDraft
      : null;

  const options = [
    {
      key: "draft",
      live: false,
      dot: <StatusDot color="var(--amber-9)" />,
      label: "Unpublished changes",
      detail: managedDraft
        ? DRAFT_STAGE_LABELS[getValuesDraftStage(managedDraft)]
        : changed.length === 1
          ? `A draft on ${changed[0].feature.id}`
          : `Drafts on ${changed.length} Feature Flags`,
    },
    {
      key: "live",
      live: true,
      dot: <StatusDot color="var(--green-9)" />,
      label: "Live",
      detail: "What this experiment serves now",
    },
  ];
  const selected = options.find((o) => o.live === live) ?? options[0];

  return (
    <DropdownMenu
      variant="soft"
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Flex align="center" gap="2" style={{ width: 240 }}>
          {selected.dot}
          <Box flexGrow="1">
            <Text weight="semibold">{selected.label}</Text>
          </Box>
          <PiCaretDownBold style={{ flexShrink: 0 }} />
        </Flex>
      }
      triggerClassName="dropdown-trigger-select-style dropdown-trigger-header"
      triggerStyle={{ paddingTop: 4, paddingBottom: 4 }}
      menuWidth="full"
      menuPlacement="end"
    >
      {options.map((o) => (
        <DropdownMenuItem
          key={o.key}
          className={`multiline-item${o.key === selected.key ? " selected-item" : ""}`}
          onClick={() => {
            setLive(o.live);
            setOpen(false);
          }}
        >
          <Flex align="center" gap="2">
            {o.dot}
            <Box>
              <Text as="div" weight="semibold">
                {o.label}
              </Text>
              <Text as="div" size="sm" color="text-low">
                {o.detail}
              </Text>
            </Box>
          </Flex>
        </DropdownMenuItem>
      ))}
    </DropdownMenu>
  );
}
