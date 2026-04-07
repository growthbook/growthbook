import { useMemo, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import Collapsible from "react-collapsible";
import { PiCaretRightBold } from "react-icons/pi";
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
  filterEnvironmentsByFeature,
} from "shared/util";
import Button from "@/ui/Button";
import HelperText from "@/ui/HelperText";
import Text from "@/ui/Text";
import { revisionLabelText } from "@/components/Features/RevisionLabel";
import { isRampGenerated } from "@/components/Features/RevisionStatusBadge";
import RadioGroup from "@/ui/RadioGroup";
import RevisionDropdown from "@/components/Features/RevisionDropdown";
import AffectedEnvironmentsBadges from "@/components/Features/AffectedEnvironmentsBadges";
import useOrgSettings from "@/hooks/useOrgSettings";
import useApi from "@/hooks/useApi";
import { useEnvironments } from "@/services/features";
import { useFeatureRevisionsContext } from "@/contexts/FeatureRevisionsContext";

export type DraftMode = "existing" | "new" | "publish";

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
  hideExisting = false,
  triggerPrefix = "Changes will be",
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
  defaultExpanded?: boolean;
  hideExisting?: boolean;
  triggerPrefix?: string;
}) {
  const [isOpen, setIsOpen] = useState(defaultExpanded ?? false);

  const activeDrafts = useMemo(
    () =>
      revisionList.filter(
        (r) =>
          !isRampGenerated(r) &&
          (ACTIVE_DRAFT_STATUSES as readonly string[]).includes(r.status),
      ),
    [revisionList],
  );

  // Use context revisions if available; fetch only when rendered outside FeaturesOverview.
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
      />
      {affectedEnvs != null && (
        <AffectedEnvironmentsBadges
          label="Affected in this draft:"
          affectedEnvs={affectedEnvs}
          allEnvironments={filterEnvironmentsByFeature(
            allEnvironments,
            feature,
          )}
          gatedEnvSet={approvalScopedEnvSet}
        />
      )}
    </Flex>
  );

  const options = [
    ...(!hideExisting && activeDrafts.length > 0
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
      <>
        {" "}
        <Text weight="semibold" as="span">
          published immediately
        </Text>
      </>
    ) : mode === "existing" && selectedRevision != null ? (
      <>
        {" added to draft: "}
        <Text weight="semibold" as="span">
          {revisionLabelText(
            selectedRevision.version,
            selectedRevision.title,
            !!selectedRevision.title,
          )}
        </Text>
      </>
    ) : (
      <>
        {" added to "}
        <Text weight="semibold" as="span">
          a new draft
        </Text>
      </>
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
      <Box style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
        <HelperText status="info">
          <div
            className="ml-1"
            style={{
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {triggerPrefix}
            {triggerLabel}
          </div>
        </HelperText>
      </Box>
      <Button
        variant="ghost"
        size="xs"
        onClick={async (e) => {
          e?.stopPropagation();
          setIsOpen((v) => !v);
        }}
        style={{ marginLeft: -5 }}
      >
        <Flex align="center" gap="1">
          {!isOpen && <span style={{ marginRight: 4 }}>edit</span>}
          <PiCaretRightBold
            className="chevron-right"
            size={14}
            style={{ margin: "0 -4px" }}
          />
        </Flex>
      </Button>
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
