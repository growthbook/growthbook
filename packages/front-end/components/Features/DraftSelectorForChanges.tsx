import { useMemo, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import Collapsible from "react-collapsible";
import { PiCaretRightBold } from "react-icons/pi";
import { FeatureInterface } from "shared/types/feature";
import { MinimalFeatureRevisionInterface } from "shared/types/feature-revision";
import { ACTIVE_DRAFT_STATUSES } from "shared/validators";
import HelperText from "@/ui/HelperText";
import Text from "@/ui/Text";
import { revisionLabelText } from "@/components/Features/RevisionLabel";
import RadioGroup from "@/ui/RadioGroup";
import RevisionDropdown from "@/components/Features/RevisionDropdown";
import AffectedEnvironmentsBadges from "@/components/Features/AffectedEnvironmentsBadges";
import OverflowText from "@/components/Experiment/TabbedPage/OverflowText";
type Mode = "existing" | "new" | "publish";

// Controlled UI for selecting where to apply a feature change.
// State init and API calls remain in the parent modal.
export default function DraftSelectorForChanges({
  feature,
  revisionList,
  autoPublish,
  setAutoPublish,
  selectedDraft,
  setSelectedDraft,
  canAutoPublish,
  gatedEnvSet,
  // "all" → single "all environments" badge; string[] → per-env badges; undefined/null → hide
  affectedEnvs = "all",
}: {
  feature: FeatureInterface;
  revisionList: MinimalFeatureRevisionInterface[];
  autoPublish: boolean;
  setAutoPublish: (v: boolean) => void;
  selectedDraft: number | null;
  setSelectedDraft: (v: number | null) => void;
  canAutoPublish: boolean;
  gatedEnvSet: Set<string> | "all" | "none";
  affectedEnvs?: string[] | "all" | null;
}) {
  const activeDrafts = useMemo(
    () =>
      revisionList.filter((r) =>
        (ACTIVE_DRAFT_STATUSES as readonly string[]).includes(r.status),
      ),
    [revisionList],
  );

  const [mode, setMode] = useState<Mode>(() => {
    if (autoPublish) return "publish";
    if (selectedDraft != null) return "existing";
    return "new";
  });

  function handleModeChange(val: string) {
    const newMode = val as Mode;
    setMode(newMode);
    if (newMode === "existing") {
      setAutoPublish(false);
      // pick the first active draft if none is currently selected
      if (selectedDraft == null && activeDrafts.length > 0) {
        setSelectedDraft(activeDrafts[0].version);
      }
    } else if (newMode === "new") {
      setAutoPublish(false);
      setSelectedDraft(null);
    } else {
      setAutoPublish(true);
    }
  }

  const existingDraftDisclosure = (
    <Flex
      direction="column"
      gap="2"
      pl="5"
      pb="1"
      mb="2"
      style={{ width: "100%" }}
    >
      <RevisionDropdown
        feature={feature}
        revisions={revisionList}
        version={selectedDraft ?? activeDrafts[0]?.version ?? null}
        setVersion={() => undefined}
        onVersionChange={setSelectedDraft}
        draftsOnly
        variant="select"
      />
      {affectedEnvs != null && (
        <AffectedEnvironmentsBadges
          label="Affected in this draft:"
          affectedEnvs={affectedEnvs}
          gatedEnvSet={gatedEnvSet}
        />
      )}
    </Flex>
  );

  const options = [
    ...(activeDrafts.length > 0
      ? [
          {
            value: "existing",
            label: "Add to existing draft",
            renderOnSelect: existingDraftDisclosure,
            renderOutsideItem: true,
          },
        ]
      : []),
    { value: "new", label: "Create a new draft" },
    ...(canAutoPublish
      ? [
          {
            value: "publish",
            label:
              gatedEnvSet !== "none"
                ? "Bypass approvals and publish now"
                : "Publish now",
          },
        ]
      : []),
  ];

  const selectedRevision =
    mode === "existing"
      ? revisionList.find(
          (r) => r.version === (selectedDraft ?? activeDrafts[0]?.version),
        )
      : null;

  const triggerLabel =
    mode === "publish" ? (
      <Text weight="semibold">published immediately</Text>
    ) : mode === "existing" && selectedRevision != null ? (
      <>
        added to draft:{" "}
        <Text weight="semibold">
          <OverflowText maxWidth={160}>
            {revisionLabelText(
              selectedRevision.version,
              selectedRevision.title,
            )}
          </OverflowText>
        </Text>
      </>
    ) : (
      <>
        added to <Text weight="semibold">a new draft</Text>
      </>
    );

  const trigger = (
    <Flex
      align="center"
      justify="between"
      gap="3"
      px="3"
      py="2"
      style={{ cursor: "pointer", userSelect: "none" }}
      className="draft-selector-collapsible-trigger"
    >
      <HelperText status="info">
        <div className="ml-1">Changes will be {triggerLabel}</div>
      </HelperText>
      <PiCaretRightBold className="chevron-right" style={{ flexShrink: 0 }} />
    </Flex>
  );

  return (
    <Box mb="5" style={{ overflow: "hidden", borderRadius: "var(--radius-2)" }}>
      <Collapsible
        trigger={trigger}
        transitionTime={150}
        contentInnerClassName="draft-selector-collapsible-content"
      >
        <Box
          px="3"
          pb="3"
          pt="2"
          style={{ backgroundColor: "var(--violet-a2)" }}
        >
          <RadioGroup
            options={options}
            value={mode}
            setValue={handleModeChange}
            width="100%"
          />
        </Box>
      </Collapsible>
    </Box>
  );
}
