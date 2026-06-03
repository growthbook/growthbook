import { useMemo, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { PiCaretDown, PiLockSimple } from "react-icons/pi";
import { FeatureInterface } from "shared/types/feature";
import { MinimalFeatureRevisionInterface } from "shared/types/feature-revision";
import { ACTIVE_DRAFT_STATUSES } from "shared/validators";
import { date } from "shared/dates";
import Text from "@/ui/Text";
import Tooltip from "@/ui/Tooltip";
import RevisionLabel, {
  revisionLabelText,
} from "@/components/Features/RevisionLabel";
import RevisionStatusBadge, {
  isRampGenerated,
} from "@/components/Features/RevisionStatusBadge";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownSubMenu,
} from "@/ui/DropdownMenu";
import { useFeatureRevisionsContext } from "@/contexts/FeatureRevisionsContext";

export type DraftMode = "existing" | "new" | "publish";

type CurrentOption = "new" | "existing" | "this" | "publish";

export default function DraftSelectorDropdown({
  feature,
  revisionList,
  mode,
  setMode,
  selectedDraft,
  setSelectedDraft,
  canAutoPublish,
  gatedEnvSet,
  hideExisting = false,
  locked = false,
  lockedTooltip,
  eligibleDraftVersions,
}: {
  feature: FeatureInterface;
  revisionList: MinimalFeatureRevisionInterface[];
  mode: DraftMode;
  setMode: (m: DraftMode) => void;
  selectedDraft: number | null;
  setSelectedDraft: (v: number | null) => void;
  canAutoPublish: boolean;
  gatedEnvSet: Set<string> | "all" | "none";
  hideExisting?: boolean;
  /**
   * When true, the dropdown is rendered as a non-interactive label pinned to
   * the currently-selected revision. The caller is responsible for ensuring
   * `mode === "existing"` and `selectedDraft` points at the pinned revision.
   */
  locked?: boolean;
  lockedTooltip?: string;
  /**
   * When provided, only drafts whose version is in this set are listed under
   * "Save to existing draft". Callers use this to mirror back-end eligibility
   * (e.g. drafts containing a matching experiment-ref rule) so the submit
   * can't fail with an opaque server-side error.
   */
  eligibleDraftVersions?: Set<number>;
}) {
  const ctx = useFeatureRevisionsContext();
  const [menuOpen, setMenuOpen] = useState(false);

  const activeDrafts = useMemo(
    () =>
      revisionList
        .filter(
          (r) =>
            !isRampGenerated(r) &&
            (ACTIVE_DRAFT_STATUSES as readonly string[]).includes(r.status) &&
            (!eligibleDraftVersions || eligibleDraftVersions.has(r.version)),
        )
        .sort((a, b) => b.version - a.version),
    [revisionList, eligibleDraftVersions],
  );

  const currentVersionIsActiveDraft =
    ctx?.currentVersion != null &&
    activeDrafts.some((r) => r.version === ctx.currentVersion);

  // Visibility:
  //  - "Apply now" is shown when canAutoPublish is true. Label is "Apply now
  //    (bypass approval)" when gatedEnvSet !== "none"; otherwise plain "Apply now".
  //  - "Save to this revision" is shown instead when !canAutoPublish AND the
  //    currently-viewed revision (from context) is an active draft. It binds
  //    to mode="existing" + selectedDraft=ctx.currentVersion.
  const showApplyNow = canAutoPublish;
  const showThisRevision = !canAutoPublish && currentVersionIsActiveDraft;
  const showExistingOption = !hideExisting && activeDrafts.length > 0;
  const isBypass = gatedEnvSet !== "none";

  const selectedExistingRevision = useMemo(
    () =>
      mode === "existing"
        ? revisionList.find(
            (r) => r.version === (selectedDraft ?? activeDrafts[0]?.version),
          )
        : null,
    [mode, revisionList, selectedDraft, activeDrafts],
  );

  const currentOption: CurrentOption = (() => {
    if (mode === "new") return "new";
    if (mode === "publish") return "publish";
    if (
      showThisRevision &&
      selectedDraft != null &&
      ctx?.currentVersion != null &&
      selectedDraft === ctx.currentVersion
    ) {
      return "this";
    }
    return "existing";
  })();

  const triggerLabel: React.ReactNode = (() => {
    if (currentOption === "publish") {
      return isBypass ? "Apply now (bypass approval)" : "Apply now";
    }
    if (currentOption === "this") {
      return "Save to this revision";
    }
    if (currentOption === "existing") {
      const revLabel = selectedExistingRevision
        ? revisionLabelText(
            selectedExistingRevision.version,
            selectedExistingRevision.title,
            !!selectedExistingRevision.title,
          )
        : null;
      return revLabel ? revLabel : "Save to existing draft";
    }
    return "Save to new draft";
  })();

  if (locked) {
    const lockedTrigger = (
      <Flex
        align="center"
        gap="2"
        className="dropdown-trigger-select-style"
        style={{
          overflow: "hidden",
          opacity: 0.85,
          cursor: "default",
          paddingLeft: 8,
          paddingRight: 8,
          borderRadius: 6,
        }}
        width="195px"
        height="24px"
      >
        <PiLockSimple style={{ flexShrink: 0 }} />
        <Box style={{ flex: 1, minWidth: 0 }}>
          <Text size="small" color="text-high">
            <span
              style={{
                display: "block",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {triggerLabel}
            </span>
          </Text>
        </Box>
      </Flex>
    );
    return (
      <Box width="195px">
        {lockedTooltip ? (
          <Tooltip content={lockedTooltip}>{lockedTrigger}</Tooltip>
        ) : (
          lockedTrigger
        )}
      </Box>
    );
  }

  const handlePickNew = () => {
    setMode("new");
    setMenuOpen(false);
  };
  const handlePickExisting = (version: number) => {
    setMode("existing");
    setSelectedDraft(version);
    setMenuOpen(false);
  };
  const handlePickPublish = () => {
    setMode("publish");
    setMenuOpen(false);
  };
  const handlePickThisRevision = () => {
    if (ctx?.currentVersion == null) return;
    setMode("existing");
    setSelectedDraft(ctx.currentVersion);
    setMenuOpen(false);
  };

  const trigger = (
    <Flex
      align="center"
      justify="between"
      gap="3"
      style={{ overflow: "hidden" }}
      width="195px"
      height="24px"
    >
      <Box style={{ flex: 1, minWidth: 0 }}>
        <Text size="small" color="text-high">
          <span
            style={{
              display: "block",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {triggerLabel}
          </span>
        </Text>
      </Box>
      <PiCaretDown style={{ flexShrink: 0 }} />
    </Flex>
  );

  return (
    <Box width="195px">
      <DropdownMenu
        variant="soft"
        trigger={trigger}
        triggerClassName="dropdown-trigger-select-style"
        menuWidth="full"
        menuPlacement="start"
        open={menuOpen}
        onOpenChange={setMenuOpen}
      >
        <DropdownMenuItem
          className={currentOption === "new" ? "selected-item" : undefined}
          onClick={handlePickNew}
        >
          Save to new draft
        </DropdownMenuItem>

        {showExistingOption && (
          <DropdownSubMenu
            trigger={
              <Flex
                align="center"
                justify="between"
                gap="2"
                style={{ width: "100%" }}
                className={
                  currentOption === "existing" ? "selected-item" : undefined
                }
              >
                <span>Save to existing draft</span>
              </Flex>
            }
          >
            {activeDrafts.map((r) => {
              const isSelected =
                mode === "existing" &&
                (selectedDraft ?? activeDrafts[0]?.version) === r.version;
              return (
                <DropdownMenuItem
                  key={r.version}
                  className={`multiline-item${isSelected ? " selected-item" : ""}`}
                  onClick={() => handlePickExisting(r.version)}
                >
                  <DraftRow r={r} liveVersion={feature.version} />
                </DropdownMenuItem>
              );
            })}
          </DropdownSubMenu>
        )}

        {showApplyNow && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className={
                currentOption === "publish" ? "selected-item" : undefined
              }
              onClick={handlePickPublish}
            >
              {isBypass ? "Apply now (bypass approval)" : "Apply now"}
            </DropdownMenuItem>
          </>
        )}

        {showThisRevision && (
          <DropdownMenuItem
            className={currentOption === "this" ? "selected-item" : undefined}
            onClick={handlePickThisRevision}
          >
            Save to this revision
          </DropdownMenuItem>
        )}
      </DropdownMenu>
    </Box>
  );
}

function DraftRow({
  r,
  liveVersion,
}: {
  r: MinimalFeatureRevisionInterface;
  liveVersion: number;
}) {
  const revDate = r.status === "published" ? r.datePublished : r.dateUpdated;
  return (
    <Flex
      align="center"
      justify="between"
      gap="3"
      minWidth="300px"
      width="100%"
    >
      <Box style={{ flex: 1, minWidth: 0 }}>
        <Text weight="semibold">
          <span
            style={{
              display: "block",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              maxWidth: 400,
            }}
            title={revisionLabelText(r.version, r.title)}
          >
            <RevisionLabel
              version={r.version}
              title={r.title}
              numbered={false}
            />
          </span>
        </Text>
      </Box>
      <Box
        flexShrink="1"
        overflow="hidden"
        style={{ textOverflow: "ellipsis" }}
      >
        {revDate && (
          <Text size="small" color="text-low" whiteSpace="nowrap">
            {"Created " + date(revDate)}
          </Text>
        )}
      </Box>
      <Box flexShrink="0">
        <RevisionStatusBadge revision={r} liveVersion={liveVersion} />
      </Box>
    </Flex>
  );
}
