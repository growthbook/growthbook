import { useMemo } from "react";
import { Box, Flex } from "@radix-ui/themes";
import Collapsible from "react-collapsible";
import {
  PiCaretRightBold,
  PiInfoFill,
  PiShieldCheckBold,
  PiShieldSlashBold,
} from "react-icons/pi";
import { FeatureInterface } from "shared/types/feature";
import {
  FeatureRevisionInterface,
  MinimalFeatureRevisionInterface,
} from "shared/types/feature-revision";
import { ACTIVE_DRAFT_STATUSES } from "shared/validators";
import { getDraftAffectedEnvironments, getReviewSetting } from "shared/util";
import HelperText from "@/ui/HelperText";
import Text from "@/ui/Text";
import { revisionLabelText } from "@/components/Features/RevisionLabel";
import RadioGroup from "@/ui/RadioGroup";
import RevisionDropdown from "@/components/Features/RevisionDropdown";
import AffectedEnvironmentsBadges from "@/components/Features/AffectedEnvironmentsBadges";
import OverflowText from "@/components/Experiment/TabbedPage/OverflowText";
import useOrgSettings from "@/hooks/useOrgSettings";
import useApi from "@/hooks/useApi";
import { useEnvironments } from "@/services/features";
import { useFeatureRevisionsContext } from "@/contexts/FeatureRevisionsContext";

export type DraftMode = "existing" | "new" | "publish";

// Controlled UI for selecting where to apply a feature change.
// State init and API calls remain in the parent modal.
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
}: {
  feature: FeatureInterface;
  /** Raw live feature document (un-merged). When provided, used as a fallback
   *  for environment state missing from old (sparse) live revisions. */
  baseFeature?: FeatureInterface;
  revisionList: MinimalFeatureRevisionInterface[];
  mode: DraftMode;
  setMode: (m: DraftMode) => void;
  selectedDraft: number | null;
  setSelectedDraft: (v: number | null) => void;
  canAutoPublish: boolean;
  gatedEnvSet: Set<string> | "all" | "none";
}) {
  const activeDrafts = useMemo(
    () =>
      revisionList.filter((r) =>
        (ACTIVE_DRAFT_STATUSES as readonly string[]).includes(r.status),
      ),
    [revisionList],
  );

  // Prefer revisions already loaded on the feature page (via context) to avoid
  // an extra network round-trip. Fall back to fetching the two specific
  // revisions we need when used outside FeaturesOverview (e.g. storybook, tests).
  const ctx = useFeatureRevisionsContext();
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

  // Org-level approval scope for badge coloring — reflects which environments
  // generally require approval for any change, independent of this specific
  // action's gating. This keeps production yellow even when toggling a dev
  // kill switch (where the action-level gatedEnvSet might be "none").
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

  // Compute affected environments by comparing the selected draft vs. live revision.
  // Uses context revisions when available (instant, no fetch), otherwise falls
  // back to the lazily-fetched data.
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

    const allEnvIds = allEnvironments.map((e) => e.id);
    // Use baseFeature (if provided, or from context) as the source of truth for
    // environment enabled state — it's the raw live doc, not draft-merged.
    const liveDoc = baseFeature ?? ctx?.baseFeature ?? feature;
    const liveFeatureEnvs = Object.fromEntries(
      Object.entries(liveDoc.environmentSettings ?? {}).map(([env, val]) => [
        env,
        !!val.enabled,
      ]),
    );
    const result = getDraftAffectedEnvironments(
      draftRevision,
      liveRevision,
      allEnvIds,
      liveFeatureEnvs,
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
        setVersion={setSelectedDraft}
        draftsOnly
        variant="select"
      />
      {affectedEnvs != null && (
        <AffectedEnvironmentsBadges
          label="Affected in this draft:"
          affectedEnvs={affectedEnvs}
          gatedEnvSet={approvalScopedEnvSet}
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
              gatedEnvSet !== "none" ? (
                <span style={{ color: "var(--red-11)" }}>
                  Bypass approvals and publish now
                </span>
              ) : (
                "Publish now"
              ),
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

  const approvalsGloballyEnabled = !!settings?.requireReviews;

  // gatedEnvSet is the authoritative signal for whether this specific action
  // is approval-gated. Callers are responsible for passing "none" when their
  // action-type-specific approval is disabled (e.g. kill switch approvals off).
  // canAutoPublish is intentionally NOT used here — admins can bypass approvals
  // but the icon should still reflect the change's gating status.
  const triggerIcon =
    gatedEnvSet !== "none" ? (
      <PiShieldCheckBold size={16} />
    ) : approvalsGloballyEnabled ? (
      <PiShieldSlashBold size={16} />
    ) : (
      <PiInfoFill size={16} />
    );

  const trigger = (
    <Flex
      align="center"
      justify="between"
      gap="3"
      px="3"
      py="4"
      style={{ cursor: "pointer", userSelect: "none" }}
      className="draft-selector-collapsible-trigger"
    >
      <HelperText status="info" icon={triggerIcon}>
        <div className="ml-1">Changes will be {triggerLabel}</div>
      </HelperText>
      <PiCaretRightBold className="chevron-right" style={{ flexShrink: 0 }} />
    </Flex>
  );

  return (
    <Box mb="5" style={{ overflow: "hidden", borderRadius: "var(--radius-4)" }}>
      <Collapsible
        trigger={trigger}
        transitionTime={75}
        contentInnerClassName="draft-selector-collapsible-content"
      >
        <Box px="3" py="3" style={{ backgroundColor: "var(--violet-a3)" }}>
          <RadioGroup
            options={options}
            value={mode}
            setValue={(v) => setMode(v as DraftMode)}
            width="100%"
          />
        </Box>
      </Collapsible>
    </Box>
  );
}
