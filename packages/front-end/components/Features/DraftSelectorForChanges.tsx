import { useMemo, useState } from "react";
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
import {
  getDraftAffectedEnvironments,
  liveRevisionFromFeature,
  getReviewSetting,
  buildEffectiveDraft,
} from "shared/util";
import { useUser } from "@/services/UserContext";
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

// Controlled UI for selecting where to apply a feature change; state and API calls stay in the parent.
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
  defaultExpanded = false,
}: {
  feature: FeatureInterface;
  // Raw live feature document (un-merged); fallback for env state missing from old sparse live revisions.
  baseFeature?: FeatureInterface;
  revisionList: MinimalFeatureRevisionInterface[];
  mode: DraftMode;
  setMode: (m: DraftMode) => void;
  selectedDraft: number | null;
  setSelectedDraft: (v: number | null) => void;
  canAutoPublish: boolean;
  gatedEnvSet: Set<string> | "all" | "none";
  defaultExpanded?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(defaultExpanded ?? false);

  const activeDrafts = useMemo(
    () =>
      revisionList.filter((r) =>
        (ACTIVE_DRAFT_STATUSES as readonly string[]).includes(r.status),
      ),
    [revisionList],
  );

  // Use context revisions if available; fetch only when used outside FeaturesOverview.
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

  // Org-level env scope for badge coloring, independent of this action's gating.
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

    const allEnvIds = allEnvironments.map((e) => e.id);
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
  const { hasCommercialFeature } = useUser();
  const hasApprovalsFeature = hasCommercialFeature("require-approvals");

  const triggerIcon = !hasApprovalsFeature ? (
    <PiInfoFill size={16} />
  ) : gatedEnvSet !== "none" ? (
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
        open={isOpen}
        handleTriggerClick={() => setIsOpen((v) => !v)}
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
