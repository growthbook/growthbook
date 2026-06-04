import { FeatureInterface } from "shared/types/feature";
import { useState, useMemo, useRef, useCallback } from "react";
import { RampScheduleInterface } from "shared/validators";
import { FeatureRevisionInterface } from "shared/types/feature-revision";
import {
  autoMerge,
  fillRevisionFromFeature,
  liveRevisionFromFeature,
  filterEnvironmentsByFeature,
  getAffectedEnvsForExperiment,
  mergeResultHasChanges,
  getReviewSetting,
} from "shared/util";
import { useForm } from "react-hook-form";
import {
  EventUserLoggedIn,
  EventUserApiKey,
} from "shared/types/events/event-types";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { FaArrowLeft } from "react-icons/fa";
import { PiLockSimple } from "react-icons/pi";
import { Box, Flex } from "@radix-ui/themes";
import { format } from "date-fns";
import EventUser from "@/components/Avatar/EventUser";
import { getCurrentUser, useUser } from "@/services/UserContext";
import { useAuth } from "@/services/auth";
import {
  useEnvironments,
  useFeatureExperimentChecklists,
} from "@/services/features";
import { getFutureScheduledStartDate } from "@/services/experiments";
import Modal from "@/components/Modal";
import Field from "@/components/Forms/Field";
import Button from "@/components/Button";
import { ExpandableDiff } from "@/components/Features/DraftModal";
import Revisionlog, { MutateLog } from "@/components/Features/RevisionLog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/Tabs";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import {
  useFeatureRevisionDiff,
  featureToFeatureRevisionDiffInput,
  mergeResultToDiffInput,
  type FeatureRevisionDiff,
} from "@/hooks/useFeatureRevisionDiff";
import Badge from "@/ui/Badge";
import HelperText from "@/ui/HelperText";
import {
  logBadgeColor,
  RampActionLabel,
  formatSimpleWindow,
} from "@/components/Features/FeatureDiffRenders";
import { useHoldouts, holdoutOccupiesRuleSlot } from "@/hooks/useHoldouts";
import RadioGroup from "@/ui/RadioGroup";
import Callout from "@/ui/Callout";
import { PreLaunchChecklistForDraft } from "@/components/Experiment/PreLaunchChecklist";
import Checkbox from "@/ui/Checkbox";
import { COMPACT_DIFF_STYLES } from "@/components/AuditHistoryExplorer/CompareAuditEventsUtils";
import Heading from "@/ui/Heading";
export interface Props {
  feature: FeatureInterface;
  version: number;
  revisions: FeatureRevisionInterface[];
  close: () => void;
  mutate: () => void;
  onPublish?: () => void;
  experimentsMap: Map<string, ExperimentInterfaceStringDates>;
  rampSchedules?: RampScheduleInterface[];
}
type ReviewSubmittedType = "Comment" | "Approved" | "Requested Changes";

export default function RequestReviewModal({
  feature,
  version,
  revisions,
  close,
  mutate,
  experimentsMap,
  rampSchedules,
  onPublish,
}: Props) {
  const allEnvironments = useEnvironments();
  const environments = filterEnvironmentsByFeature(allEnvironments, feature);
  const [showSubmitReview, setShowSumbmitReview] = useState(false);
  const [adminPublish, setAdminPublish] = useState(false);
  const revisionLogRef = useRef<MutateLog>(null);
  const commentInputRef = useRef<HTMLInputElement>(null);

  const { apiCall } = useAuth();
  const user = getCurrentUser();
  const { organization, users } = useUser();
  const permissionsUtil = usePermissionsUtil();
  const canAdminPublish = permissionsUtil.canBypassApprovalChecks(feature);
  const featureLockedByRamp =
    rampSchedules?.some(
      (rs) => rs.lockdownConfig?.mode === "locked" && rs.status === "running",
    ) ?? false;
  const revision = revisions.find((r) => r.version === version);
  const isPendingReview =
    revision?.status === "pending-review" ||
    revision?.status === "changes-requested";
  const createdBy = revision?.createdBy as
    | EventUserLoggedIn
    | EventUserApiKey
    | undefined;
  const requireReviews = organization?.settings?.requireReviews;
  const reviewSetting = Array.isArray(requireReviews)
    ? getReviewSetting(requireReviews, feature)
    : undefined;
  const isBlockedContributor =
    reviewSetting?.blockSelfApproval &&
    (revision?.contributors ?? []).some((id) => id === user?.id);
  const canReview =
    isPendingReview &&
    createdBy?.id !== user?.id &&
    permissionsUtil.canReviewFeatureDrafts(feature);
  const approved = revision?.status === "approved" || adminPublish;
  const baseRevision = revisions.find(
    (r) => r.version === revision?.baseVersion,
  );
  const liveRevision = revisions.find((r) => r.version === feature.version);

  const envIds = environments.map((e) => e.id);
  const { holdoutsMap } = useHoldouts();

  const mergeResult = useMemo(() => {
    if (!revision || !baseRevision || !liveRevision) return null;
    return autoMerge(
      liveRevisionFromFeature(liveRevision, feature),
      fillRevisionFromFeature(baseRevision, feature),
      revision,
      envIds,
      {},
    );
  }, [revision, baseRevision, liveRevision, envIds, feature]);

  const [comment, setComment] = useState("");

  const { experiments, immediateStartExperiments, scheduledExperiments } =
    useFeatureExperimentChecklists({
      feature,
      revision,
      experimentsMap,
    });

  const [selectedExperiments, setSelectedExperiments] = useState(
    new Set(experiments.map((e) => e.id)),
  );
  const [experimentsStep, setExperimentsStep] = useState(false);

  const selectedImmediateCount = immediateStartExperiments.filter((e) =>
    selectedExperiments.has(e.id),
  ).length;
  const selectedScheduledCount = scheduledExperiments.filter((e) =>
    selectedExperiments.has(e.id),
  ).length;
  const onlyScheduledSelected =
    selectedImmediateCount === 0 && selectedScheduledCount > 0;

  // Aggregates per-experiment checklist state from child components.
  // Cleared when entering/leaving the experiments step to avoid stale entries
  // from previously shown/unchecked experiments.
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

  // Exclude no-op diffs (e.g. semantic equality but different raw strings)
  const resultDiffsWithChanges = useMemo(
    () => resultDiffs.filter((d) => d.a !== d.b),
    [resultDiffs],
  );

  // adminPublish bypasses the approval requirement, checklist gate, and lockdown.
  const submitEnabled =
    !(experimentsStep && checklistBlocked && !adminPublish) &&
    (!featureLockedByRamp || adminPublish);
  const hasNextStep =
    approved && selectedExperiments.size > 0 && !experimentsStep;

  const submitReviewform = useForm<{
    reviewStatus: ReviewSubmittedType;
    comment: string;
  }>({
    defaultValues: {
      reviewStatus: "Comment",
    },
  });
  const submitButton = async () => {
    if (hasNextStep) {
      checklistStateRef.current.clear();
      setChecklistBlocked(false);
      setExperimentsStep(true);
      return;
    }

    if (!isPendingReview && !approved) {
      try {
        await apiCall(`/feature/${feature.id}/${revision?.version}/request`, {
          method: "POST",
          body: JSON.stringify({
            mergeResultSerialized: JSON.stringify(mergeResult),
            comment,
          }),
        });
      } catch (e) {
        mutate();
        throw e;
      }
      await mutate();
      close();
    } else if (approved) {
      try {
        await apiCall(`/feature/${feature.id}/${revision?.version}/publish`, {
          method: "POST",
          body: JSON.stringify({
            mergeResultSerialized: JSON.stringify(mergeResult),
            comment,
            adminOverride: adminPublish,
            publishExperimentIds: Array.from(selectedExperiments),
          }),
        });
      } catch (e) {
        mutate();
        throw e;
      }
      await mutate();
      onPublish && onPublish();
      close();
    } else if (canReview) {
      setShowSumbmitReview(true);
    } else {
      close();
    }
  };

  // Activating ramps: pending ramps where this revision's publication triggers the start lifecycle.
  const activatingRamps = (rampSchedules ?? []).filter(
    (r) =>
      r.status === "pending" &&
      r.targets.some(
        (t) =>
          t.entityId === feature.id &&
          t.activatingRevisionVersion === revision?.version,
      ),
  );

  // 1-based rule indices for `Rule #N` refs in diff summaries. Holdout
  // occupies #1 (matching Rule.tsx's numbering) only when it's enabled in
  // some env; a feature can carry a holdout reference whose holdout is
  // disabled everywhere, in which case the rules list shows no holdout row.
  const draftRules = Array.isArray(revision?.rules) ? revision!.rules : [];
  const draftRuleNumberOffset = holdoutOccupiesRuleSlot(
    revision?.holdout,
    holdoutsMap,
  )
    ? 2
    : 1;
  const draftRuleIndexById = new Map<string, number>(
    draftRules.map((r, i) => [r.id, i + draftRuleNumberOffset]),
  );
  // Fall back to the raw ID for any rule we can't number (e.g. a detach
  // action whose rule was deleted from the draft).
  const ruleRef = (ruleId: string): string => {
    const idx = draftRuleIndexById.get(ruleId);
    return idx ? `Rule #${idx}` : `Rule ${ruleId}`;
  };

  const rampDiffs: FeatureRevisionDiff[] = [
    ...activatingRamps.map((ramp) => {
      const rampConfig = {
        name: ramp.name,
        targets: ramp.targets,
        startDate: ramp.startDate,
        steps: ramp.steps,
        cutoffDate: ramp.cutoffDate,
      };
      const isSimple = ramp.steps.length === 0;
      const endAt = ramp.cutoffDate ?? undefined;
      const kindLabel = isSimple ? "Schedule" : "Ramp Schedule";
      const detail = isSimple
        ? formatSimpleWindow(ramp.startDate, endAt)
        : `${ramp.steps.length} step${ramp.steps.length !== 1 ? "s" : ""}${
            ramp.startDate ? "" : " · starts on publish"
          }`;
      return {
        title: `${kindLabel} – ${ramp.name}`,
        titleSuffix: <RampActionLabel action="activate" />,
        a: "",
        b: JSON.stringify(rampConfig, null, 2),
        customRender: detail ? (
          <p className="mb-0 text-muted">{detail}.</p>
        ) : null,
        badges: [
          {
            label: `Start ${isSimple ? "schedule" : "ramp"}: ${ramp.name}`,
            action: isSimple ? "start schedule" : "start ramp",
          },
        ],
      } as FeatureRevisionDiff;
    }),
    // Pending ramp actions: create/detach actions queued in the draft.
    // Skip actions whose target rule was deleted from the draft — they're
    // orphaned no-ops that the publish cleanup will discard anyway.
    ...(revision?.rampActions ?? [])
      .filter((action) => {
        const ruleId = (action as { ruleId?: string }).ruleId;
        if (!ruleId) return true;
        return (revision?.rules ?? []).some((r) => r.id === ruleId);
      })
      .map((action) => {
        if (action.mode === "create") {
          const rampConfig = {
            name: action.name,
            environment: action.environment,
            ruleId: action.ruleId,
            startDate: action.startDate,
            steps: action.steps,
            cutoffDate: action.cutoffDate,
          };
          const isSimple = action.steps.length === 0;
          const endAt = action.cutoffDate ?? undefined;
          const kindLabel = isSimple ? "Schedule" : "Ramp Schedule";
          const displayName = action.name ?? "schedule";
          const detail = isSimple
            ? formatSimpleWindow(action.startDate, endAt)
            : `${action.steps.length} step${
                action.steps.length !== 1 ? "s" : ""
              }`;
          return {
            title: `${kindLabel} – ${displayName}`,
            titleSuffix: <RampActionLabel action="create" />,
            a: "",
            b: JSON.stringify(rampConfig, null, 2),
            customRender: (
              <p className="mb-0 text-muted">
                {ruleRef(action.ruleId)}
                {detail ? ` · ${detail}` : ""}.
              </p>
            ),
            badges: [
              {
                label: `Create ${isSimple ? "schedule" : "ramp"}: ${displayName}`,
                action: isSimple ? "create schedule" : "create ramp",
              },
            ],
          } as FeatureRevisionDiff;
        } else if (action.mode === "update") {
          const rampConfig = {
            rampScheduleId: action.rampScheduleId,
            name: action.name,
            ruleId: action.ruleId,
            startDate: action.startDate,
            steps: action.steps,
            cutoffDate: action.cutoffDate,
          };
          const isSimpleUpdate = action.steps.length === 0;
          const kindLabelUpdate = isSimpleUpdate ? "Schedule" : "Ramp Schedule";
          const displayName = action.name ?? "schedule";
          return {
            title: `${kindLabelUpdate} – ${displayName}`,
            titleSuffix: <RampActionLabel action="update" />,
            a: "",
            b: JSON.stringify(rampConfig, null, 2),
            customRender: (
              <p className="mb-0 text-muted">
                {ruleRef(action.ruleId)} · updates schedule configuration.
              </p>
            ),
            badges: [
              {
                label: isSimpleUpdate
                  ? "Update schedule"
                  : "Update ramp schedule",
                action: "update ramp",
              },
            ],
          } as FeatureRevisionDiff;
        } else if (action.mode === "detach") {
          // The detach action only carries a rampScheduleId, so resolve the
          // target schedule (if still available) to pick the right wording.
          const targetSchedule = (rampSchedules ?? []).find(
            (r) => r.id === action.rampScheduleId,
          );
          const isSimple =
            !!targetSchedule && targetSchedule.steps.length === 0;
          const kindLabel = isSimple ? "Schedule" : "Ramp Schedule";
          const kindNoun = isSimple ? "schedule" : "ramp schedule";
          const scheduleName = targetSchedule?.name;
          return {
            title: scheduleName ? `${kindLabel} – ${scheduleName}` : kindLabel,
            titleSuffix: <RampActionLabel action="remove" />,
            a: "",
            b: JSON.stringify(
              {
                rampScheduleId: action.rampScheduleId,
                ruleId: action.ruleId,
              },
              null,
              2,
            ),
            customRender: (
              <p className="mb-0 text-muted">
                {ruleRef(action.ruleId)} will be removed from this {kindNoun}
                {action.deleteScheduleWhenEmpty &&
                  "; the schedule is deleted if no targets remain"}
                .
              </p>
            ),
            badges: [
              {
                label: `Remove from ${kindNoun}`,
                action: isSimple ? "remove schedule" : "remove ramp",
              },
            ],
          } as FeatureRevisionDiff;
        }
        return null as unknown as FeatureRevisionDiff;
      })
      .filter(Boolean),
  ];

  const linkedRamps = [
    ...activatingRamps.map((ramp) => ({ ramp, role: "activating" as const })),
  ];

  if (!revision || !mergeResult) return null;
  const allDiffsWithChanges = [...resultDiffsWithChanges, ...rampDiffs];
  const hasChanges = mergeResultHasChanges(mergeResult) || rampDiffs.length > 0;
  let ctaCopy: string | JSX.Element = "Request Review";
  if (approved && !hasNextStep) {
    ctaCopy = featureLockedByRamp ? (
      <>
        <PiLockSimple /> Publish
      </>
    ) : onlyScheduledSelected ? (
      "Schedule to Start"
    ) : (
      "Publish"
    );
  } else if (canReview || hasNextStep) {
    ctaCopy = "Next";
  }
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
        return;
    }
  };
  const renderRequestAndViewModal = () => {
    return (
      <Modal
        trackingEventModalType=""
        open={true}
        header={"Review Draft Changes"}
        useRadixButton={true}
        cta={ctaCopy}
        ctaEnabled={submitEnabled}
        close={close}
        autoCloseOnSubmit={false}
        closeCta="Cancel"
        size="lg"
        submit={
          !isPendingReview || canReview || approved ? submitButton : undefined
        }
        backCTA={
          experimentsStep ? (
            <Button
              color="link"
              onClick={() => {
                checklistStateRef.current.clear();
                setChecklistBlocked(false);
                setExperimentsStep(false);
              }}
            >
              <FaArrowLeft /> Back
            </Button>
          ) : undefined
        }
      >
        {mergeResult.conflicts.length > 0 && (
          <Callout status="error">
            <strong>Conflicts Detected</strong>. Please fix conflicts before
            publishing this draft.
          </Callout>
        )}

        {linkedRamps.map(({ ramp }) => (
          <Callout key={ramp.id} status="info" mb="3">
            Publishing this draft will activate ramp schedule{" "}
            <strong>{ramp.name}</strong>. The ramp will begin once this revision
            is live.
          </Callout>
        ))}

        {!hasChanges && !mergeResult.conflicts.length && (
          <Callout status="info">
            There are no changes to publish. Either discard the draft or add
            changes first before publishing.
          </Callout>
        )}

        {mergeResult.success && hasChanges && (
          <div>
            <div className="mb-2">{showRevisionStatus()}</div>
            {(() => {
              const authorId =
                revision.createdBy &&
                "id" in revision.createdBy &&
                revision.createdBy.id
                  ? revision.createdBy.id
                  : undefined;
              const contribIds = revision.contributors ?? [];
              const allIds =
                authorId && !contribIds.includes(authorId)
                  ? [authorId, ...contribIds]
                  : contribIds;
              return (
                allIds.length > 0 && (
                  <div className="mb-3">
                    <strong style={{ fontSize: "0.85rem" }}>
                      Contributors
                    </strong>
                    <Flex align="center" gap="2" wrap="wrap" mt="1">
                      {allIds.map((id) => {
                        const u = users.get(id);
                        return (
                          <Flex key={id} align="center" gap="1" wrap="wrap">
                            <EventUser
                              user={{
                                type: "dashboard",
                                id,
                                name: u?.name || "",
                                email: u?.email || "",
                              }}
                              display="avatar-name-email"
                              size="sm"
                            />
                          </Flex>
                        );
                      })}
                    </Flex>
                  </div>
                )
              );
            })()}
            {featureLockedByRamp && (
              <Callout
                status="warning"
                icon={<PiLockSimple size={15} />}
                mb="3"
              >
                Publishing is locked by an active ramp-up schedule.
                {canAdminPublish
                  ? " Use the admin bypass below to publish anyway."
                  : ""}
              </Callout>
            )}
            {canAdminPublish && (
              <div className="mt-3 mb-4 ml-1">
                <Checkbox
                  label="Bypass approval and lockdown restrictions to publish (optional for Admins only)"
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
              </div>
            )}

            {experimentsStep && approved ? (
              <div>
                <h3>
                  Review &amp; {onlyScheduledSelected ? "Schedule" : "Publish"}
                </h3>
                <p>
                  Please review the{" "}
                  <strong>
                    Pre-Launch Checklist
                    {selectedExperiments.size !== 1 ? "s" : ""}
                  </strong>{" "}
                  for the experiment
                  {selectedExperiments.size !== 1 ? "s" : ""} that will be{" "}
                  {onlyScheduledSelected ? "scheduled to start" : "published"}{" "}
                  along with this draft.
                </p>
                {experiments.map((experiment) => {
                  if (!selectedExperiments.has(experiment.id)) return null;

                  const scheduledStartDate =
                    getFutureScheduledStartDate(experiment);

                  return (
                    <div key={experiment.id} className="mb-3">
                      {scheduledStartDate && (
                        <Callout status="info" mb="2">
                          <strong>{experiment.name}</strong> will start on{" "}
                          <strong>
                            {format(
                              scheduledStartDate,
                              "MMM d, yyyy 'at' h:mm a",
                            )}
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
                    </div>
                  );
                })}
              </div>
            ) : (
              <>
                {approved && experiments.length > 0 ? (
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
                                if (e === true) {
                                  newValue.add(experiment.id);
                                } else {
                                  newValue.delete(experiment.id);
                                }
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
                                if (e === true) {
                                  newValue.add(experiment.id);
                                } else {
                                  newValue.delete(experiment.id);
                                }
                                setSelectedExperiments(newValue);
                              }}
                              label={experiment.name}
                            />
                          </Box>
                        ))}
                      </Box>
                    )}
                  </Box>
                ) : null}
                {allDiffsWithChanges.length > 0 && (
                  <>
                    <h4 className="mb-3">Summary of changes</h4>
                    {allDiffsWithChanges.flatMap((d) => d.badges ?? []).length >
                      0 && (
                      <Flex wrap="wrap" gap="2" className="mb-3">
                        {allDiffsWithChanges
                          .flatMap((d) => d.badges ?? [])
                          .map(({ label, action }) => (
                            <Badge
                              key={label}
                              color={logBadgeColor(action)}
                              variant="soft"
                              label={label}
                            />
                          ))}
                      </Flex>
                    )}
                    {allDiffsWithChanges.some((d) => d.customRender) && (
                      <div className="list-group mb-4">
                        {allDiffsWithChanges
                          .filter((d) => d.customRender)
                          .map((d) => (
                            <div key={d.title} className="appbox bg-light p-3">
                              <strong className="d-block mb-2">
                                {d.title}
                              </strong>
                              {d.customRender}
                            </div>
                          ))}
                      </div>
                    )}
                  </>
                )}
                <h4 className="mb-3">Change details</h4>
                <div className="list-group mb-4">
                  {allDiffsWithChanges.length > 0 ? (
                    allDiffsWithChanges.map((diff) => (
                      <ExpandableDiff
                        key={diff.title}
                        title={diff.title}
                        a={diff.a}
                        b={diff.b}
                        styles={COMPACT_DIFF_STYLES}
                      />
                    ))
                  ) : (
                    <HelperText status="info">
                      No material changes detected
                    </HelperText>
                  )}
                </div>
                {(isPendingReview || revision.status === "approved") && (
                  <div className="mb-4">
                    <Tabs defaultValue="review">
                      <TabsList size="2" mb="2">
                        <TabsTrigger value="review">
                          Review Activity
                        </TabsTrigger>
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
                  </div>
                )}
                {(!canReview || approved) && (
                  <div className="mt-3" id="comment-section">
                    <Field
                      label="Add a Comment (optional)"
                      textarea
                      placeholder="Summary of changes..."
                      value={comment}
                      ref={commentInputRef}
                      onChange={(e) => {
                        setComment(e.target.value);
                      }}
                    />
                    {((!canReview && revision?.status !== "draft") ||
                      approved) && (
                      <Button
                        onClick={async () => {
                          try {
                            await apiCall(
                              `/feature/${feature.id}/${revision.version}/comment`,
                              {
                                method: "POST",
                                body: JSON.stringify({
                                  comment,
                                }),
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
                          // close();
                        }}
                      >
                        Comment
                      </Button>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </Modal>
    );
  };
  const renderReviewAndSubmitModal = () => {
    return (
      <Modal
        trackingEventModalType=""
        open={true}
        close={close}
        header={"Review Draft Changes"}
        useRadixButton={true}
        cta={"Submit"}
        size="lg"
        includeCloseCta={false}
        submit={submitReviewform.handleSubmit(async (data) => {
          try {
            await apiCall(
              `/feature/${feature.id}/${revision?.version}/submit-review`,
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
          <Button
            color="link"
            onClick={async () => setShowSumbmitReview(false)}
          >
            <FaArrowLeft /> Back
          </Button>
        }
      >
        <div style={{ padding: "0 30px" }}>
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
                description:
                  "Submit general feedback without explicit approval.",
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
        </div>
      </Modal>
    );
  };

  return showSubmitReview
    ? renderReviewAndSubmitModal()
    : renderRequestAndViewModal();
}
