import { useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { PiCaretDownBold } from "react-icons/pi";
import {
  ExperimentInterfaceStringDates,
  LinkedFeatureInfo,
  LinkedFeaturePendingDraft,
} from "shared/types/experiment";
import { isManagedByExperiment } from "shared/util";
import Text from "@/ui/Text";
import { DropdownMenu, DropdownMenuItem } from "@/ui/DropdownMenu";
import UnpublishedDot from "@/components/Experiment/UnpublishedDot";
import { hasUnpublishedChanges } from "@/components/Experiment/LinkedChanges/linkedFeatureDiff";
import { useLiveView } from "./ExperimentEdits";
import { valuesAreSetup } from "./useExperimentEditing";

function LiveDot() {
  return (
    <Box
      style={{
        flexShrink: 0,
        width: 8,
        height: 8,
        borderRadius: "50%",
        background: "var(--green-9)",
      }}
    />
  );
}

// Where the unpublished changes stand, in the viewer's terms.
function draftState(draft: LinkedFeaturePendingDraft): string {
  if (draft.hasMergeConflict || draft.rebaseRequired) {
    return "Out of date with live";
  }
  if (!draft.pendingApproval) return "Not yet published";
  if (draft.status === "pending-review") return "Awaiting review";
  if (draft.status === "changes-requested") return "Changes requested";
  if (draft.status === "approved") return "Approved, not yet published";
  return "Not yet sent for review";
}

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
      dot: <UnpublishedDot />,
      label: "Unpublished changes",
      detail: managedDraft
        ? draftState(managedDraft)
        : changed.length === 1
          ? `A draft on ${changed[0].feature.id}`
          : `Drafts on ${changed.length} Feature Flags`,
    },
    {
      key: "live",
      live: true,
      dot: <LiveDot />,
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
