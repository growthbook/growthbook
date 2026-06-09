import { FeatureInterface } from "shared/types/feature";
import { useState, useMemo, useRef, useCallback } from "react";
import {
  RampScheduleInterface,
  ACTIVE_DRAFT_STATUSES,
} from "shared/validators";
import {
  FeatureRevisionInterface,
  MinimalFeatureRevisionInterface,
} from "shared/types/feature-revision";
import {
  autoMerge,
  fillRevisionFromFeature,
  liveRevisionFromFeature,
  filterEnvironmentsByFeature,
  getAffectedEnvsForExperiment,
  getEnvsFromRampSchedule,
  mergeResultHasChanges,
  getReviewSetting,
  checkIfRevisionNeedsReview,
  evaluatePublishGovernance,
  getLiveChangesSinceBase,
  MergeStrategy,
} from "shared/util";
import { useForm } from "react-hook-form";
import {
  EventUserLoggedIn,
  EventUserApiKey,
} from "shared/types/events/event-types";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { FaArrowLeft } from "react-icons/fa";
import { PiLockSimple, PiGitMergeBold } from "react-icons/pi";
import { Box, Flex } from "@radix-ui/themes";
import { format } from "date-fns";
import EventUser from "@/components/Avatar/EventUser";
import { getCurrentUser, useUser } from "@/services/UserContext";
import { useAuth } from "@/services/auth";
import useOrgSettings from "@/hooks/useOrgSettings";
import {
  getAffectedRevisionEnvs,
  useEnvironments,
  useFeatureExperimentChecklists,
} from "@/services/features";
import { getFutureScheduledStartDate } from "@/services/experiments";
import Modal from "@/components/Modal";
import PagedModal from "@/components/Modal/PagedModal";
import Page from "@/components/Modal/Page";
import Field from "@/components/Forms/Field";
import LinkButton from "@/components/Button";
import Revisionlog, { MutateLog } from "@/components/Features/RevisionLog";
import RevisionLabel from "@/components/Features/RevisionLabel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/Tabs";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import {
  useFeatureRevisionDiff,
  featureToFeatureRevisionDiffInput,
  mergeResultToDiffInput,
  normalizeRevisionMetadata,
  FeatureRevisionDiffInput,
} from "@/hooks/useFeatureRevisionDiff";
import Button from "@/ui/Button";
import Text from "@/ui/Text";
import Heading from "@/ui/Heading";
import Badge from "@/ui/Badge";
import {
  revisionStatusColor,
  revisionStatusLabel,
} from "@/components/Features/RevisionStatusBadge";
import Callout from "@/ui/Callout";
import RadioGroup from "@/ui/RadioGroup";
import Checkbox from "@/ui/Checkbox";
import { useHoldouts } from "@/hooks/useHoldouts";
import { PreLaunchChecklistForDraft } from "@/components/Experiment/PreLaunchChecklist";
import { COMPACT_DIFF_STYLES } from "@/components/AuditHistoryExplorer/CompareAuditEventsUtils";
import {
  ExpandableDiff,
  ExpandableConflict,
  buildRampDiffs,
  DiffContent,
} from "@/components/Features/RevisionDiffUtils";
import DivergenceNotice from "@/components/Features/DivergenceNotice";
import RevertModal from "@/components/Features/RevertModal";
import { getReviewAndPublishState } from "@/components/Features/reviewAndPublishState";

export interface Props {
  // The base (live) feature.
  feature: FeatureInterface;
  revisions: FeatureRevisionInterface[];
  // Minimal revision list (up to 200) — used by the revert flow's dropdown.
  revisionList: MinimalFeatureRevisionInterface[];
  // The version currently selected in the URL (?v=). This is the single source
  // of truth for which revision the tab is reviewing: an active draft renders
  // the review/publish flow; any other status renders a read-only review.
  version: number;
  // Update the selected version (writes ?v= to the URL).
  setVersion: (version: number) => void;
  mutate: () => void;
  // Navigate away from the tab (e.g. back to Overview) after publishing or from
  // the empty state.
  onClose?: () => void;
  onPublish?: () => void;
  experiments?: ExperimentInterfaceStringDates[];
  rampSchedules?: RampScheduleInterface[];
}

type ReviewSubmittedType = "Comment" | "Approved" | "Requested Changes";

// The feature-page "Review and Publish" tab. Consolidates the former DraftModal
// (direct publish), RequestReviewModal (review lifecycle), and
// FeatureFixConflictsModal (rebase / conflict resolution) into a single page
// surface. Conflict resolution and review submission run as focused modals
// launched from the page. CTA/routing decisions come from
// getReviewAndPublishState; the divergence/stale-approval governance comes from
// evaluatePublishGovernance.
export default function ReviewAndPublish({
  feature,
  version,
  setVersion,
  revisions,
  revisionList,
  mutate,
  onClose,
  onPublish,
  experiments: experimentsList,
  rampSchedules,
}: Props) {
  const allEnvironments = useEnvironments();
  const environments = filterEnvironmentsByFeature(allEnvironments, feature);
  const envIds = environments.map((e) => e.id);
  const permissionsUtil = usePermissionsUtil();
  const { apiCall } = useAuth();
  const user = getCurrentUser();
  const { users, hasCommercialFeature } = useUser();
  const settings = useOrgSettings();
  const { holdoutsMap } = useHoldouts();

  // The tab is driven entirely by the selected version (?v= in the URL). The
  // header's RevisionDropdown determines which revision we're reviewing; this
  // component never silently substitutes a different draft.
  const revision = revisions.find((r) => r.version === version) ?? null;
  const isActiveDraft =
    !!revision &&
    (ACTIVE_DRAFT_STATUSES as readonly string[]).includes(revision.status);
  const isLive = !!revision && revision.version === feature.version;
  const baseRevision = revisions.find(
    (r) => r.version === revision?.baseVersion,
  );
  const liveRevision = revisions.find((r) => r.version === feature.version);

  // --- Read-only review (selected version is not an active draft) ----------
  const [revertOpen, setRevertOpen] = useState(false);
  const liveBaseInput = useMemo(
    () => featureToFeatureRevisionDiffInput(feature),
    [feature],
  );
  const toDiffInput = useCallback(
    (r: FeatureRevisionInterface): FeatureRevisionDiffInput => ({
      defaultValue: r.defaultValue,
      rules: Array.isArray(r.rules) ? r.rules : [],
      environmentsEnabled:
        r.environmentsEnabled ?? liveBaseInput.environmentsEnabled,
      prerequisites: r.prerequisites ?? liveBaseInput.prerequisites,
      archived: r.archived ?? liveBaseInput.archived,
      holdout:
        r.holdout !== undefined ? r.holdout : (liveBaseInput.holdout ?? null),
      metadata: normalizeRevisionMetadata(r.metadata) ?? liveBaseInput.metadata,
      rampActions: r.rampActions ?? undefined,
    }),
    [liveBaseInput],
  );
  // Read-only diff: the selected (published/live) revision vs. the revision it
  // was based on, i.e. the changes this revision introduced when published.
  const readonlyBaseRevision = revisions.find(
    (r) => r.version === revision?.baseVersion,
  );
  const readonlyBeforeInput = readonlyBaseRevision
    ? toDiffInput(readonlyBaseRevision)
    : liveBaseInput;
  const readonlyAfterInput = revision ? toDiffInput(revision) : liveBaseInput;
  const readonlyDiffs = useFeatureRevisionDiff({
    current: readonlyBeforeInput,
    draft: readonlyAfterInput,
  });
  // The previously-published revision to roll back to when viewing the live one.
  const previousPublishedRevision = useMemo(() => {
    const live = revisions.find((r) => r.version === feature.version);
    const livePublishedAt = live?.datePublished
      ? new Date(live.datePublished).getTime()
      : Infinity;
    return (
      revisions
        .filter(
          (r) =>
            r.status === "published" &&
            r.version !== feature.version &&
            !!r.datePublished &&
            new Date(r.datePublished).getTime() < livePublishedAt,
        )
        .sort((a, b) => {
          const bt = b.datePublished ? new Date(b.datePublished).getTime() : 0;
          const at = a.datePublished ? new Date(a.datePublished).getTime() : 0;
          return bt - at;
        })[0] ?? null
    );
  }, [revisions, feature.version]);

  const [strategies, setStrategies] = useState<Record<string, MergeStrategy>>(
    {},
  );
  const [conflictStep, setConflictStep] = useState(0);
  const [resolveConflicts, setResolveConflicts] = useState(false);
  const [comment, setComment] = useState(revision?.comment || "");
  const [adminPublish, setAdminPublish] = useState(false);
  const [rebasing, setRebasing] = useState(false);
  const [experimentsStep, setExperimentsStep] = useState(false);
  const [showSubmitReview, setShowSubmitReview] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const revisionLogRef = useRef<MutateLog>(null);
  const commentInputRef = useRef<HTMLInputElement>(null);

  const mergeResult = useMemo(() => {
    if (!revision || !baseRevision || !liveRevision) return null;
    return autoMerge(
      liveRevisionFromFeature(liveRevision, feature),
      fillRevisionFromFeature(baseRevision, feature),
      revision,
      envIds,
      strategies,
    );
  }, [revision, baseRevision, liveRevision, envIds, strategies, feature]);

  const canAdminPublish = permissionsUtil.canBypassApprovalChecks(feature);
  const featureLockedByRamp =
    rampSchedules?.some(
      (rs) => rs.lockdownConfig?.mode === "locked" && rs.status === "running",
    ) ?? false;

  const isPendingReview =
    revision?.status === "pending-review" ||
    revision?.status === "changes-requested";
  const createdBy = revision?.createdBy as
    | EventUserLoggedIn
    | EventUserApiKey
    | undefined;
  const requireReviewSettings = settings?.requireReviews;
  const reviewSetting = Array.isArray(requireReviewSettings)
    ? getReviewSetting(requireReviewSettings, feature)
    : undefined;
  const isBlockedContributor =
    reviewSetting?.blockSelfApproval &&
    (revision?.contributors ?? []).some((id) => id === user?.id);
  const canReview =
    !!isPendingReview &&
    createdBy?.id !== user?.id &&
    permissionsUtil.canReviewFeatureDrafts(feature);
  const approved = revision?.status === "approved" || adminPublish;

  const liveChanges = useMemo(() => {
    if (!liveRevision || !baseRevision) return [];
    return getLiveChangesSinceBase(
      liveRevisionFromFeature(liveRevision, feature),
      fillRevisionFromFeature(baseRevision, feature),
      envIds,
    );
  }, [liveRevision, baseRevision, feature, envIds]);

  const governance = useMemo(() => {
    if (!revision || !mergeResult) return null;
    return evaluatePublishGovernance({
      revisionStatus: revision.status,
      baseVersion: revision.baseVersion,
      liveVersion: feature.version,
      mergeSuccess: mergeResult.success,
      liveChanges,
      approvedBaseVersion: revision.approvedBaseVersion ?? null,
      requireRebaseBeforePublish: !!settings?.requireRebaseBeforePublish,
    });
  }, [revision, mergeResult, feature.version, liveChanges, settings]);

  const experimentsMap = useMemo<
    Map<string, ExperimentInterfaceStringDates>
  >(() => {
    if (!experimentsList) return new Map();
    return new Map(experimentsList.map((exp) => [exp.id, exp]));
  }, [experimentsList]);

  const { experiments, immediateStartExperiments, scheduledExperiments } =
    useFeatureExperimentChecklists({
      feature,
      revision: revision ?? undefined,
      experimentsMap,
    });

  const [selectedExperiments, setSelectedExperiments] = useState(
    new Set(experiments.map((e) => e.id)),
  );

  const selectedImmediateCount = immediateStartExperiments.filter((e) =>
    selectedExperiments.has(e.id),
  ).length;
  const selectedScheduledCount = scheduledExperiments.filter((e) =>
    selectedExperiments.has(e.id),
  ).length;
  const onlyScheduledSelected =
    selectedImmediateCount === 0 && selectedScheduledCount > 0;

  const checklistStateRef = useRef<
    Map<string, { failedRequired: boolean; loading: boolean }>
  >(new Map());
  const [checklistBlocked, setChecklistBlocked] = useState(false);
  const handleChecklistReady = useCallback(
    (expId: string, failedRequired: boolean, loading: boolean) => {
      checklistStateRef.current.set(expId, { failedRequired, loading });
      setChecklistBlocked(
        [...checklistStateRef.current.values()].some(
          (v) => v.failedRequired || v.loading,
        ),
      );
    },
    [],
  );

  const currentRevisionData = featureToFeatureRevisionDiffInput(feature);
  const draftDiffInput = mergeResult?.success
    ? mergeResultToDiffInput(mergeResult.result, currentRevisionData)
    : currentRevisionData;
  const resultDiffs = useFeatureRevisionDiff({
    current: currentRevisionData,
    draft: draftDiffInput,
  });
  // `draftDiffInput` intentionally omits fields the merge didn't touch (its
  // presence semantics drive the sectional diff above). For the whole-object
  // "Raw JSON" view we need a complete object, otherwise unchanged fields look
  // like deletions — so layer the merged changes over the current revision.
  const draftRawAfter = { ...currentRevisionData, ...draftDiffInput };

  const rampDiffs = useMemo(
    () =>
      revision
        ? buildRampDiffs({ feature, revision, rampSchedules, holdoutsMap })
        : [],
    [feature, revision, rampSchedules, holdoutsMap],
  );

  const submitReviewform = useForm<{
    reviewStatus: ReviewSubmittedType;
    comment: string;
  }>({ defaultValues: { reviewStatus: "Comment" } });

  const onUpdateFromLive = async () => {
    if (!revision || !mergeResult?.success) return;
    setRebasing(true);
    try {
      await apiCall(`/feature/${feature.id}/${revision.version}/rebase`, {
        method: "POST",
        body: JSON.stringify({
          mergeResultSerialized: JSON.stringify(mergeResult),
          strategies: {},
        }),
      });
      await mutate();
    } finally {
      setRebasing(false);
    }
  };

  const pageWrapper = (children: React.ReactNode) => (
    <Box className="contents container-fluid pagecontents pt-4">{children}</Box>
  );

  // The selected version doesn't exist yet (still loading) or ?v= is invalid.
  if (!revision) {
    return pageWrapper(
      <Callout status="info">
        Select a revision from the dropdown above to review.
        {onClose && (
          <Box mt="2">
            <Button variant="soft" onClick={() => onClose()}>
              Back to Overview
            </Button>
          </Box>
        )}
      </Callout>,
    );
  }

  // Read-only review: the selected version is not an active draft. Show the
  // changes this revision introduced (vs. its base). The only actions are
  // "Revert to this revision" (a previously-published revision) or "Roll back"
  // (the live revision) — no review/approval/publish actions.
  if (!isActiveDraft) {
    const revertTarget = isLive
      ? previousPublishedRevision
      : revision.status === "published"
        ? revision
        : null;
    const canRevert =
      permissionsUtil.canManageFeatureDrafts(feature) && !!revertTarget;
    // Same GitHub-style header as the draft path, but the summary line describes
    // the terminal state (merged/published, live, or discarded) instead of a
    // pending merge.
    const status = isLive ? "live" : revision.status;
    const headerTitle =
      revision.title?.trim() ||
      revision.comment?.trim() ||
      `Revision ${revision.version}`;
    const baseV = readonlyBaseRevision?.version;
    const publishedDate = revision.datePublished
      ? format(new Date(revision.datePublished), "MMM d, yyyy")
      : null;
    const discardedDate = revision.dateUpdated
      ? format(new Date(revision.dateUpdated), "MMM d, yyyy")
      : null;

    return pageWrapper(
      <>
        {revertOpen && revertTarget && (
          <RevertModal
            feature={feature}
            revision={revertTarget}
            revisionList={revisionList}
            allRevisions={revisions}
            close={() => setRevertOpen(false)}
            mutate={mutate}
            setVersion={setVersion}
          />
        )}
        <Box mb="4">
          <Flex justify="between" align="start" gap="4">
            <Box style={{ flex: 1, minWidth: 0 }}>
              <Heading as="h2" size="x-large" mb="2">
                {headerTitle}
              </Heading>
              <Flex align="center" gap="2">
                <Box style={{ flexShrink: 0 }}>
                  <Badge
                    size="lg"
                    variant="soft"
                    radius="full"
                    color={revisionStatusColor(status)}
                    label={revisionStatusLabel(status)}
                  />
                </Box>
                <Text as="span" color="text-low">
                  {revision.status === "discarded" ? (
                    <>
                      Revision <strong>{revision.version}</strong>
                      {baseV != null ? (
                        <> (based on revision {baseV})</>
                      ) : null}{" "}
                      was discarded{discardedDate ? ` on ${discardedDate}` : ""}
                    </>
                  ) : (
                    <>
                      Revision <strong>{revision.version}</strong>
                      {baseV != null ? (
                        <>
                          {" "}
                          was merged into revision <strong>{baseV}</strong> and
                          published
                        </>
                      ) : (
                        <> was published</>
                      )}
                      {publishedDate ? ` on ${publishedDate}` : ""}
                    </>
                  )}
                </Text>
              </Flex>
            </Box>
            {canRevert && revertTarget && (
              <Button
                color="red"
                variant="soft"
                onClick={() => setRevertOpen(true)}
              >
                {isLive ? "Roll back" : "Revert to this revision"}
              </Button>
            )}
          </Flex>
        </Box>

        <DiffContent
          diffs={readonlyDiffs}
          commentVersions={[
            {
              version: revision.version,
              revisionComment: revision.comment,
              title: revision.title,
            },
          ]}
          feature={feature}
          outOfOrderWarning={false}
          raw={{ before: readonlyBeforeInput, after: readonlyAfterInput }}
        />

        <Box mt="6" pt="5" style={{ borderTop: "1px solid var(--gray-a5)" }}>
          <Heading as="h3" size="small" mb="2">
            Change log
          </Heading>
          <Revisionlog feature={feature} revision={revision} />
        </Box>
      </>,
    );
  }

  // Active draft, but the merge baseline hasn't loaded yet (rare).
  if (!mergeResult) {
    return pageWrapper(<Callout status="info">Loading draft changes…</Callout>);
  }

  const allDiffs = [...resultDiffs, ...rampDiffs];
  const hasChanges = mergeResultHasChanges(mergeResult) || rampDiffs.length > 0;
  const linkedRamps = (rampSchedules ?? []).filter(
    (r) =>
      r.status === "pending" &&
      r.targets.some(
        (t) =>
          t.entityId === feature.id &&
          t.activatingRevisionVersion === revision.version,
      ),
  );

  const hasPublishPermission = permissionsUtil.canPublishFeature(
    feature,
    getAffectedRevisionEnvs(feature, revision, environments),
  );

  // Determine whether approvals are required by diffing the merged result
  // against live (mirrors the feature overview's gating calculation).
  let requireReviews = false;
  if (baseRevision) {
    const filledBaseRevision = {
      ...baseRevision,
      ...fillRevisionFromFeature(baseRevision, feature),
    };
    const filledRevision = {
      ...revision,
      ...fillRevisionFromFeature(revision, feature),
    };
    let effectiveRevision: typeof filledRevision = filledRevision;
    let effectiveBase: typeof filledBaseRevision = filledBaseRevision;
    if (mergeResult.success && liveRevision) {
      const filledLive = {
        ...liveRevision,
        ...liveRevisionFromFeature(liveRevision, feature),
      };
      effectiveRevision = {
        ...filledLive,
        ...mergeResult.result,
        rules: mergeResult.result.rules ?? filledLive.rules,
        rampActions: revision.rampActions,
      };
      effectiveBase = filledLive;
    }
    requireReviews = checkIfRevisionNeedsReview({
      feature,
      baseRevision: effectiveBase,
      revision: effectiveRevision,
      allEnvironments: envIds,
      settings,
      requireApprovalsLicensed: hasCommercialFeature("require-approvals"),
      liveRampScheduleEnvs: (() => {
        const map = new Map<string, string[] | "all">();
        for (const action of effectiveRevision.rampActions ?? []) {
          if (action.mode !== "update") continue;
          const liveSchedule = rampSchedules?.find(
            (rs) => rs.id === action.rampScheduleId,
          );
          if (liveSchedule) {
            map.set(
              action.rampScheduleId,
              getEnvsFromRampSchedule(liveSchedule),
            );
          }
        }
        return map;
      })(),
    });
  }

  const state = getReviewAndPublishState({
    requireReviews,
    status: revision.status,
    mergeSuccess: mergeResult.success,
    hasChanges,
    canReview,
    adminPublish,
    hasSelectedExperiments: selectedExperiments.size > 0,
    onlyScheduledSelected,
    experimentsStep,
    showSubmitReview,
    featureLockedByRamp,
    checklistBlocked,
    governanceCanPublish: governance ? governance.canPublish : true,
  });

  const doSubmit = async () => {
    setSubmitError(null);
    try {
      switch (state.submitAction) {
        case "next-experiments":
          checklistStateRef.current.clear();
          setChecklistBlocked(false);
          setExperimentsStep(true);
          return;
        case "request-review":
          setSubmitting(true);
          await apiCall(`/feature/${feature.id}/${revision.version}/request`, {
            method: "POST",
            body: JSON.stringify({
              mergeResultSerialized: JSON.stringify(mergeResult),
              comment,
            }),
          });
          await mutate();
          onClose && onClose();
          return;
        case "publish":
          setSubmitting(true);
          await apiCall(`/feature/${feature.id}/${revision.version}/publish`, {
            method: "POST",
            body: JSON.stringify({
              mergeResultSerialized: JSON.stringify(mergeResult),
              comment,
              adminOverride: adminPublish,
              publishExperimentIds: Array.from(selectedExperiments),
            }),
          });
          await mutate();
          onPublish && onPublish();
          onClose && onClose();
          return;
        case "show-submit-review":
          setShowSubmitReview(true);
          return;
        default:
          return;
      }
    } catch (e) {
      await mutate();
      setSubmitError(e.message || "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  };

  const showRevisionStatus = () => {
    switch (revision.status) {
      case "approved":
        return <Callout status="success">Approved</Callout>;
      case "pending-review":
        return <Callout status="warning">Pending Review</Callout>;
      case "changes-requested":
        return <Callout status="error">Changes Requested</Callout>;
      case "draft":
        return <Callout status="warning">Publishing requires approval</Callout>;
      default:
        return null;
    }
  };

  const authorId =
    revision.createdBy && "id" in revision.createdBy && revision.createdBy.id
      ? revision.createdBy.id
      : undefined;
  const contribIds = revision.contributors ?? [];
  const contributorIds =
    authorId && !contribIds.includes(authorId)
      ? [authorId, ...contribIds]
      : contribIds;

  const renderExperimentSelection = () =>
    experiments.length > 0 ? (
      <Box mb="3">
        {immediateStartExperiments.length > 0 && (
          <Box mb={scheduledExperiments.length > 0 ? "3" : "0"}>
            <Heading as="h4" size="small" mb="2">
              Start running experiments upon publishing:
            </Heading>
            {immediateStartExperiments.map((experiment) => (
              <Box key={experiment.id}>
                <Checkbox
                  value={selectedExperiments.has(experiment.id)}
                  setValue={(e) => {
                    const newValue = new Set(selectedExperiments);
                    if (e === true) newValue.add(experiment.id);
                    else newValue.delete(experiment.id);
                    setSelectedExperiments(newValue);
                  }}
                  label={experiment.name}
                />
              </Box>
            ))}
          </Box>
        )}
        {scheduledExperiments.length > 0 && (
          <Box>
            <Heading as="h4" size="small" mb="2">
              Approve scheduled start for experiments:
            </Heading>
            {scheduledExperiments.map((experiment) => (
              <Box key={experiment.id}>
                <Checkbox
                  value={selectedExperiments.has(experiment.id)}
                  setValue={(e) => {
                    const newValue = new Set(selectedExperiments);
                    if (e === true) newValue.add(experiment.id);
                    else newValue.delete(experiment.id);
                    setSelectedExperiments(newValue);
                  }}
                  label={experiment.name}
                />
              </Box>
            ))}
          </Box>
        )}
      </Box>
    ) : null;

  // ── Focused sub-flow modals (launched from the page) ──
  const conflictModal =
    resolveConflicts && !mergeResult.success ? (
      <PagedModal
        trackingEventModalType="resolve-conflicts"
        header={"Resolve Conflicts"}
        step={conflictStep}
        setStep={setConflictStep}
        submit={async () => {
          try {
            await apiCall(`/feature/${feature.id}/${revision.version}/rebase`, {
              method: "POST",
              body: JSON.stringify({
                mergeResultSerialized: JSON.stringify(mergeResult),
                strategies,
              }),
            });
          } catch (e) {
            await mutate();
            throw e;
          }
          await mutate();
        }}
        cta={conflictStep === 1 ? "Update Draft" : "Next"}
        ctaEnabled={!!mergeResult.success}
        close={() => setResolveConflicts(false)}
        closeCta="Cancel"
        size="max"
        useRadixButton={true}
      >
        <Page
          display="Fix Conflicts"
          enabled
          validate={async () => {
            if (!mergeResult?.success) {
              throw new Error("Please resolve all conflicts first");
            }
          }}
        >
          <Box
            mb="4"
            style={{ maxWidth: 800, margin: "0 auto var(--space-4)" }}
          >
            <Callout
              status="info"
              contentsAs="div"
              icon={<PiGitMergeBold size={18} />}
            >
              <Text as="p">
                Your draft is based on an older version, and the live version
                has since been published with conflicting changes. Resolve each
                conflict below, then click{" "}
                <Text as="span" weight="medium">
                  Update Draft
                </Text>{" "}
                to rebase your draft onto the current live version.
              </Text>
            </Callout>
          </Box>
          {mergeResult.conflicts.map((conflict) => (
            <ExpandableConflict
              conflict={conflict}
              key={conflict.name}
              strategy={strategies[conflict.key] || ""}
              setStrategy={(strategy) => {
                setStrategies({ ...strategies, [conflict.key]: strategy });
              }}
              liveRevision={liveRevision}
              draftRevision={revision}
            />
          ))}
        </Page>
        <Page display="Review Changes">
          {hasChanges ? (
            <Flex direction="column" gap="4">
              {resultDiffs
                .filter((d) => d.a !== d.b)
                .map((diff) => (
                  <ExpandableDiff
                    key={diff.title}
                    {...diff}
                    defaultOpen
                    styles={COMPACT_DIFF_STYLES}
                    leftTitle={
                      <RevisionLabel
                        version={liveRevision?.version ?? 0}
                        title={liveRevision?.title}
                        minWidth={0}
                      />
                    }
                    rightTitle={
                      <RevisionLabel
                        version={revision.version}
                        title={revision.title}
                        minWidth={0}
                      />
                    }
                  />
                ))}
            </Flex>
          ) : (
            <Text as="p" color="text-low">
              Your draft and the live version are identical.
            </Text>
          )}
        </Page>
      </PagedModal>
    ) : null;

  const submitReviewModal = showSubmitReview ? (
    <Modal
      trackingEventModalType=""
      open={true}
      close={() => setShowSubmitReview(false)}
      header={"Submit Review"}
      useRadixButton={true}
      cta={"Submit"}
      size="lg"
      includeCloseCta={false}
      submit={submitReviewform.handleSubmit(async (data) => {
        try {
          await apiCall(
            `/feature/${feature.id}/${revision.version}/submit-review`,
            {
              method: "POST",
              body: JSON.stringify({
                comment: data.comment,
                review: data.reviewStatus,
              }),
            },
          );
        } catch (e) {
          mutate();
          throw e;
        }
        await mutate();
      })}
      backCTA={
        <LinkButton
          color="link"
          onClick={async () => setShowSubmitReview(false)}
        >
          <FaArrowLeft /> Back
        </LinkButton>
      }
    >
      <div>
        <h4>Leave a Comment</h4>
        <Field
          placeholder="Leave a comment"
          textarea
          className="mb-3 mt-3"
          {...submitReviewform.register("comment")}
        />
      </div>
      <RadioGroup
        value={submitReviewform.watch("reviewStatus")}
        setValue={(val: ReviewSubmittedType) => {
          submitReviewform.setValue("reviewStatus", val);
        }}
        options={[
          {
            value: "Comment",
            label: "Comment",
            description: "Submit general feedback without explicit approval.",
          },
          {
            value: "Requested Changes",
            label: "Request Changes",
            description:
              "Submit feedback that must be addressed before publishing.",
          },
          {
            value: "Approved",
            label: "Approve",
            description: isBlockedContributor
              ? "You contributed to this draft and cannot approve it."
              : "Submit feedback and approve for publishing.",
            disabled: isBlockedContributor,
          },
        ]}
      />
    </Modal>
  ) : null;

  const canDoPrimary =
    state.submitAction === "publish" ? hasPublishPermission : true;

  // ── Simple full-width states (no two-column layout) ──
  if (!mergeResult.success) {
    return pageWrapper(
      <>
        {conflictModal}
        <Callout status="error" contentsAs="div">
          <Text as="p" weight="semibold" mb="1">
            Conflicts detected
          </Text>
          <Text as="p" mb="2">
            Changes were published to the live version that conflict with this
            draft. Resolve the conflicts to rebase your draft before publishing.
          </Text>
          <Button onClick={() => setResolveConflicts(true)}>
            Resolve conflicts
          </Button>
        </Callout>
      </>,
    );
  }
  if (!hasChanges) {
    return pageWrapper(
      <Callout status="info">
        There are no changes to publish. Either discard the draft or add changes
        first before publishing.
      </Callout>,
    );
  }

  // ── Full-width header (GitHub PR style): big title, status badge, and a
  // one-line summary of which revision merges into which. We surface the review
  // requester (the revision author) once a review has actually been requested;
  // otherwise we just describe what would be merged. ──
  // Match the status colors/labels used by the revision selector badge.
  const reviewRequested =
    requireReviews &&
    (revision.status === "pending-review" ||
      revision.status === "approved" ||
      revision.status === "changes-requested");
  const requester = authorId ? users.get(authorId) : undefined;
  const requesterName = requester?.name || requester?.email || "";
  const headerTitle =
    revision.title?.trim() ||
    revision.comment?.trim() ||
    `Revision ${revision.version}`;
  const staleBase = revision.baseVersion !== feature.version;

  const mergeHeader = (
    <Box mb="6">
      <Heading as="h3" size="large" mb="2">
        {headerTitle}
      </Heading>
      <Flex align="center" gap="2">
        <Box style={{ flexShrink: 0 }}>
          <Badge
            size="lg"
            variant="soft"
            radius="full"
            color={revisionStatusColor(revision.status)}
            label={revisionStatusLabel(revision.status)}
          />
        </Box>
        <Text as="span" color="text-low">
          {reviewRequested && requesterName ? (
            <>
              <strong>{requesterName}</strong> requested review to merge{" "}
            </>
          ) : (
            <>Merging </>
          )}
          revision <strong>{revision.version}</strong> into the live version
          (revision <strong>{feature.version}</strong>)
          {staleBase ? <> · based on revision {revision.baseVersion}</> : null}
        </Text>
      </Flex>
    </Box>
  );

  // ── Left column: all of the changes, then history ──
  const changesColumn = experimentsStep ? (
    <Box>
      <Heading as="h3" size="medium" mb="3">
        Review &amp; {onlyScheduledSelected ? "Schedule" : "Publish"}
      </Heading>
      <Text as="p" mb="3">
        Please review the{" "}
        <strong>
          Pre-Launch Checklist
          {selectedExperiments.size !== 1 ? "s" : ""}
        </strong>{" "}
        for the experiment
        {selectedExperiments.size !== 1 ? "s" : ""} that will be{" "}
        {onlyScheduledSelected ? "scheduled to start" : "published"} along with
        this draft.
      </Text>
      {experiments.map((experiment) => {
        if (!selectedExperiments.has(experiment.id)) return null;
        const scheduledStartDate = getFutureScheduledStartDate(experiment);
        return (
          <Box key={experiment.id} mb="3">
            {scheduledStartDate && (
              <Callout status="info" mb="2">
                <strong>{experiment.name}</strong> will start on{" "}
                <strong>
                  {format(scheduledStartDate, "MMM d, yyyy 'at' h:mm a")}
                </strong>
                .
              </Callout>
            )}
            <PreLaunchChecklistForDraft
              experiment={experiment}
              feature={feature}
              mutateExperiment={mutate}
              envs={getAffectedEnvsForExperiment({
                experiment,
                orgEnvironments: allEnvironments,
                linkedFeatures: [],
              })}
              onReady={(failed, loading) =>
                handleChecklistReady(experiment.id, failed, loading)
              }
            />
          </Box>
        );
      })}
    </Box>
  ) : (
    <Box>
      <DiffContent
        diffs={allDiffs}
        commentVersions={[
          {
            version: revision.version,
            revisionComment: revision.comment,
            title: revision.title,
          },
        ]}
        feature={feature}
        outOfOrderWarning={false}
        raw={{ before: currentRevisionData, after: draftRawAfter }}
        isDraftNotes={isActiveDraft}
        canEditNotes={permissionsUtil.canManageFeatureDrafts(feature)}
        onNotesSaved={mutate}
      />

      <Box mt="6" pt="5" style={{ borderTop: "1px solid var(--gray-a5)" }}>
        {requireReviews &&
        (isPendingReview || revision.status === "approved") ? (
          <Tabs defaultValue="review">
            <TabsList size="2" mb="2">
              <TabsTrigger value="review">Review Activity</TabsTrigger>
              <TabsTrigger value="full">Change Log</TabsTrigger>
            </TabsList>
            <TabsContent value="review">
              <Revisionlog
                feature={feature}
                revision={revision}
                ref={revisionLogRef}
                reviewOnly
              />
            </TabsContent>
            <TabsContent value="full">
              <Revisionlog feature={feature} revision={revision} />
            </TabsContent>
          </Tabs>
        ) : (
          <>
            <Heading as="h4" size="small" color="text-mid" mb="3">
              Change log
            </Heading>
            <Revisionlog
              feature={feature}
              revision={revision}
              ref={revisionLogRef}
            />
          </>
        )}
      </Box>
    </Box>
  );

  // ── Right column: reviewer / approval-flow actions and state ──
  const actionsColumn = (
    <Box className="appbox" p="4" style={{ position: "sticky", top: 90 }}>
      {governance && (
        <DivergenceNotice
          governance={governance}
          liveVersion={feature.version}
          baseVersion={revision.baseVersion}
          onUpdateFromLive={onUpdateFromLive}
          updating={rebasing}
          canRebase={permissionsUtil.canManageFeatureDrafts(feature)}
        />
      )}

      {linkedRamps.map((ramp) => (
        <Callout key={ramp.id} status="info" mb="3">
          Publishing this draft will activate ramp schedule{" "}
          <strong>{ramp.name}</strong>. The ramp will begin once this revision
          is live.
        </Callout>
      ))}

      {requireReviews && <Box mb="3">{showRevisionStatus()}</Box>}

      {requireReviews && contributorIds.length > 0 && (
        <Box mb="3">
          <Text size="small" weight="medium" color="text-mid" as="div" mb="1">
            Contributors
          </Text>
          <Flex direction="column" gap="1">
            {contributorIds.map((id) => {
              const u = users.get(id);
              return (
                <EventUser
                  key={id}
                  user={{
                    type: "dashboard",
                    id,
                    name: u?.name || "",
                    email: u?.email || "",
                  }}
                  display="avatar-name-email"
                  size="sm"
                />
              );
            })}
          </Flex>
        </Box>
      )}

      {featureLockedByRamp && (
        <Callout status="warning" icon={<PiLockSimple size={15} />} mb="3">
          Publishing is locked by an active ramp-up schedule.
          {canAdminPublish
            ? " Use the admin bypass below to publish anyway."
            : ""}
        </Callout>
      )}
      {canAdminPublish && (featureLockedByRamp || requireReviews) && (
        <Box mb="3">
          <Checkbox
            label={
              requireReviews
                ? "Bypass approval and lockdown restrictions to publish (Admins only)"
                : "Bypass lockdown to publish (admin only)"
            }
            value={adminPublish}
            setValue={(val) => {
              setAdminPublish(!!val);
              if (!val) {
                checklistStateRef.current.clear();
                setChecklistBlocked(false);
                setExperimentsStep(false);
              }
            }}
          />
        </Box>
      )}

      {!experimentsStep &&
        (approved || !requireReviews) &&
        renderExperimentSelection()}

      {!requireReviews ? (
        hasPublishPermission ? (
          <Field
            label="Notes (optional)"
            textarea
            placeholder="Summary of changes..."
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
        ) : (
          <Callout status="info">
            You do not have permission to publish this draft.
          </Callout>
        )
      ) : (
        (!canReview || approved) && (
          <Box id="comment-section">
            <Field
              label="Add a Comment (optional)"
              textarea
              placeholder="Summary of changes..."
              value={comment}
              ref={commentInputRef}
              onChange={(e) => setComment(e.target.value)}
            />
            {((!canReview && revision.status !== "draft") || approved) && (
              <LinkButton
                onClick={async () => {
                  try {
                    await apiCall(
                      `/feature/${feature.id}/${revision.version}/comment`,
                      {
                        method: "POST",
                        body: JSON.stringify({ comment }),
                      },
                    );
                  } catch (e) {
                    await mutate();
                    throw e;
                  }
                  setComment("");
                  await revisionLogRef?.current?.mutateLog();
                  await mutate();
                  commentInputRef?.current?.scrollIntoView();
                }}
              >
                Comment
              </LinkButton>
            )}
          </Box>
        )
      )}

      {submitError && (
        <Callout status="error" mt="3">
          {submitError}
        </Callout>
      )}

      {state.mode === "main" && state.hasSubmit && (
        <Flex direction="column" gap="2" mt="4">
          <Button
            onClick={doSubmit}
            loading={submitting}
            disabled={!(state.ctaEnabled && canDoPrimary)}
            icon={state.ctaLocked ? <PiLockSimple /> : undefined}
            style={{ width: "100%" }}
          >
            {state.ctaLabel}
          </Button>
          {experimentsStep && (
            <LinkButton
              color="link"
              onClick={() => {
                checklistStateRef.current.clear();
                setChecklistBlocked(false);
                setExperimentsStep(false);
              }}
            >
              <FaArrowLeft /> Back
            </LinkButton>
          )}
        </Flex>
      )}
    </Box>
  );

  return pageWrapper(
    <>
      {conflictModal}
      {submitReviewModal}
      {mergeHeader}
      <Flex gap="5" align="start">
        <Box style={{ flex: 1, minWidth: 0 }}>{changesColumn}</Box>
        <Box style={{ width: 360, minWidth: 360, flexShrink: 0 }}>
          {actionsColumn}
        </Box>
      </Flex>
    </>,
  );
}
