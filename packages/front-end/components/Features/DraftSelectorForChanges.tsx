import { useMemo, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { PiCaretDown } from "react-icons/pi";
import { FeatureInterface } from "shared/types/feature";
import {
  FeatureRevisionInterface,
  MinimalFeatureRevisionInterface,
} from "shared/types/feature-revision";
import { ACTIVE_DRAFT_STATUSES } from "shared/validators";
import { dateNoYear } from "shared/dates";
import {
  getDraftAffectedEnvironments,
  liveRevisionFromFeature,
  getReviewSetting,
  buildEffectiveDraft,
  filterEnvironmentsByFeature,
} from "shared/util";
import Text from "@/ui/Text";
import RevisionLabel, {
  revisionLabelText,
} from "@/components/Features/RevisionLabel";
import RevisionStatusBadge, {
  isRampGenerated,
} from "@/components/Features/RevisionStatusBadge";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownSubMenu,
} from "@/ui/DropdownMenu";
import EventUser from "@/components/Avatar/EventUser";
import AffectedEnvironmentsBadges from "@/components/Features/AffectedEnvironmentsBadges";
import useOrgSettings from "@/hooks/useOrgSettings";
import useApi from "@/hooks/useApi";
import { useEnvironments } from "@/services/features";
import { useFeatureRevisionsContext } from "@/contexts/FeatureRevisionsContext";

export type DraftMode = "existing" | "new" | "publish";

type CurrentOption = "new" | "existing" | "this" | "publish";

export default function DraftSelectorForChanges({
  feature,
  baseFeature,
  revisionList,
  mode,
  setMode,
  selectedDraft,
  setSelectedDraft,
  canAutoPublish,
  gatedEnvSet,
  hideExisting = false,
}: {
  feature: FeatureInterface;
  // Un-merged live feature doc; fallback for env state on old sparse live revisions.
  baseFeature?: FeatureInterface;
  revisionList: MinimalFeatureRevisionInterface[];
  mode: DraftMode;
  setMode: (m: DraftMode) => void;
  selectedDraft: number | null;
  setSelectedDraft: (v: number | null) => void;
  canAutoPublish: boolean;
  gatedEnvSet: Set<string> | "all" | "none";
  hideExisting?: boolean;
  /** @deprecated no-op; retained for backward compatibility. */
  defaultExpanded?: boolean;
  /** @deprecated no-op; retained for backward compatibility. */
  triggerPrefix?: string;
}) {
  const ctx = useFeatureRevisionsContext();
  const [menuOpen, setMenuOpen] = useState(false);

  const activeDrafts = useMemo(
    () =>
      revisionList
        .filter(
          (r) =>
            !isRampGenerated(r) &&
            (ACTIVE_DRAFT_STATUSES as readonly string[]).includes(r.status),
        )
        .sort((a, b) => b.version - a.version),
    [revisionList],
  );

  const currentVersionIsActiveDraft =
    ctx?.currentVersion != null &&
    activeDrafts.some((r) => r.version === ctx.currentVersion);

  // Use context revisions if available; fetch only when rendered outside FeaturesOverview.
  const draftVersionForFetch =
    mode === "existing" && !ctx
      ? (selectedDraft ?? activeDrafts[0]?.version ?? null)
      : null;
  const { data: fetchedRevisionsData } = useApi<{
    status: 200;
    revisions: FeatureRevisionInterface[];
  }>(
    `/feature/${feature.id}/revisions?versions=${feature.version},${draftVersionForFetch ?? 0}`,
    { shouldRun: () => draftVersionForFetch != null },
  );

  // Org-level approval scope for badge coloring; independent of this action's gating.
  const settings = useOrgSettings();
  const approvalScopedEnvSet = useMemo<Set<string> | "all" | "none">(() => {
    const raw = settings?.requireReviews;
    if (!raw) return "none";
    if (raw === true) return "all";
    if (!Array.isArray(raw)) return "none";
    const reviewSetting = getReviewSetting(raw, feature);
    if (!reviewSetting?.requireReviewOn) return "none";
    const envs = reviewSetting.environments ?? [];
    return envs.length === 0 ? "all" : new Set(envs);
  }, [settings?.requireReviews, feature]);

  const allEnvironments = useEnvironments();
  const affectedEnvs = useMemo<string[] | "all" | null>(() => {
    if (mode !== "existing") return null;
    const draftVersion = selectedDraft ?? activeDrafts[0]?.version;
    if (draftVersion == null) return null;

    const revisions = ctx?.revisions ?? fetchedRevisionsData?.revisions;
    if (!revisions) return null;

    const liveRevision = revisions.find((r) => r.version === feature.version);
    const draftRevision = revisions.find((r) => r.version === draftVersion);
    if (!liveRevision || !draftRevision) return null;

    const allEnvIds = filterEnvironmentsByFeature(allEnvironments, feature).map(
      (e) => e.id,
    );
    const liveDoc = baseFeature ?? ctx?.baseFeature ?? feature;
    const filledLive = liveRevisionFromFeature(liveRevision, liveDoc);
    const effectiveDraft = buildEffectiveDraft(draftRevision, filledLive);

    const result = getDraftAffectedEnvironments(
      effectiveDraft,
      filledLive,
      allEnvIds,
    );
    if (Array.isArray(result) && result.length === 0) return null;
    return result;
  }, [
    mode,
    selectedDraft,
    activeDrafts,
    ctx,
    fetchedRevisionsData,
    feature,
    baseFeature,
    allEnvironments,
  ]);

  // Visibility:
  //  - "Apply now" is shown when canAutoPublish is true. Label gets "(bypass
  //    approval)" in red when gatedEnvSet !== "none"; otherwise plain "Apply now".
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

  // Trigger label text shows the current selection
  const triggerLabel: React.ReactNode = (() => {
    if (currentOption === "publish") {
      return isBypass ? (
        <Text color="text-high">
          <span style={{ color: "var(--red-11)" }}>
            Apply now (bypass approval)
          </span>
        </Text>
      ) : (
        "Apply now"
      );
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
      return revLabel
        ? `Save to existing draft: ${revLabel}`
        : "Save to existing draft";
    }
    return "Save to new draft";
  })();

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
          <DropdownMenuItem
            className={
              currentOption === "publish" ? "selected-item" : undefined
            }
            color={isBypass ? "red" : undefined}
            onClick={handlePickPublish}
          >
            {isBypass ? "Apply now (bypass approval)" : "Apply now"}
          </DropdownMenuItem>
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

      {/* {mode === "existing" && affectedEnvs != null && (
        <Box mt="2">
          <AffectedEnvironmentsBadges
            label="Affected in this draft:"
            affectedEnvs={affectedEnvs}
            allEnvironments={filterEnvironmentsByFeature(
              allEnvironments,
              feature,
            )}
            gatedEnvSet={approvalScopedEnvSet}
          />
        </Box>
      )} */}
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
    <Flex align="center" justify="between" gap="3" style={{ width: "100%" }}>
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
            <RevisionLabel version={r.version} title={r.title} />
          </span>
        </Text>
      </Box>
      <Box
        flexShrink="1"
        overflow="hidden"
        style={{ textOverflow: "ellipsis" }}
      >
        {(r.createdBy || revDate) && (
          <Text size="small" color="text-low" whiteSpace="nowrap">
            {r.createdBy?.type === "system" ? (
              <em>generated</em>
            ) : r.createdBy ? (
              <EventUser user={r.createdBy} display="name" />
            ) : null}
            {r.createdBy && revDate && <> &middot; </>}
            {revDate && dateNoYear(revDate)}
          </Text>
        )}
      </Box>
      <Box flexShrink="0">
        <RevisionStatusBadge revision={r} liveVersion={liveVersion} />
      </Box>
    </Flex>
  );
}
