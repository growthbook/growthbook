import { FeatureInterface } from "shared/types/feature";
import { useState, useMemo, useRef } from "react";
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
import { Flex } from "@radix-ui/themes";
import EventUser from "@/components/Avatar/EventUser";
import { getCurrentUser, useUser } from "@/services/UserContext";
import { useAuth } from "@/services/auth";
import {
  useEnvironments,
  useFeatureExperimentChecklists,
} from "@/services/features";
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
import { logBadgeColor } from "@/components/Features/FeatureDiffRenders";
import RadioGroup from "@/ui/RadioGroup";
import Callout from "@/ui/Callout";
import { PreLaunchChecklistFeatureExpRule } from "@/components/Experiment/PreLaunchChecklist";
import Checkbox from "@/ui/Checkbox";
import { COMPACT_DIFF_STYLES } from "@/components/AuditHistoryExplorer/CompareAuditEventsUtils";
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
  const { organization } = useUser();
  const permissionsUtil = usePermissionsUtil();
  const canAdminPublish = permissionsUtil.canBypassApprovalChecks(feature);
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
    (revision?.contributors ?? []).some(
      (c) => c != null && "id" in c && c.id === user?.id,
    );
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

  const { experimentData } = useFeatureExperimentChecklists({
    feature,
    revision,
    experimentsMap,
  });

  const [selectedExperiments, setSelectedExperiments] = useState(
    new Set(experimentData.map((e) => e.experiment.id)),
  );
  const [experimentsStep, setExperimentsStep] = useState(false);

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

  let submitEnabled = true;
  if (experimentsStep && experimentData.some((d) => d.failedRequired)) {
    submitEnabled = false;
  }
  // If we're publishing experiments, next step is to review pre-launch checklists
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

  const rampDiffs: FeatureRevisionDiff[] = [
    ...activatingRamps.map((ramp) => {
      const rampConfig = {
        name: ramp.name,
        targets: ramp.targets,
        startDate: ramp.startDate,
        steps: ramp.steps,
        endCondition: ramp.endCondition,
      };
      const startDescription = ramp.startDate
        ? "Starts at a scheduled date/time."
        : "Starts automatically on publish.";
      return {
        title: `Ramp Schedule – ${ramp.name}`,
        a: "",
        b: JSON.stringify(rampConfig, null, 2),
        customRender: (
          <p className="mb-0">
            Activates ramp schedule <strong>{ramp.name}</strong> —{" "}
            {ramp.steps.length} step{ramp.steps.length !== 1 ? "s" : ""}.{" "}
            {startDescription}
          </p>
        ),
        badges: [{ label: `Start ramp: ${ramp.name}`, action: "start ramp" }],
      } as FeatureRevisionDiff;
    }),
    // Pending ramp actions: create/detach actions queued in the draft
    ...(revision?.rampActions ?? [])
      .map((action) => {
        if (action.mode === "create") {
          const rampConfig = {
            name: action.name,
            environment: action.environment,
            ruleId: action.ruleId,
            startDate: action.startDate,
            steps: action.steps,
            endCondition: action.endCondition,
          };
          return {
            title: `Ramp Schedule – ${action.name} (pending creation)`,
            a: "",
            b: JSON.stringify(rampConfig, null, 2),
            customRender: (
              <p className="mb-0">
                Creates ramp schedule <strong>{action.name}</strong> for rule{" "}
                <code>{action.ruleId}</code> — {action.steps.length} step
                {action.steps.length !== 1 ? "s" : ""}.
              </p>
            ),
            badges: [
              {
                label: `Create ramp: ${action.name}`,
                action: "create ramp",
              },
            ],
          } as FeatureRevisionDiff;
        } else if (action.mode === "detach") {
          return {
            title: `Remove from Ramp Schedule (pending)`,
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
              <p className="mb-0">
                This rule will be removed from its ramp schedule
                {action.deleteScheduleWhenEmpty &&
                  " and the schedule will be deleted if empty"}
                .
              </p>
            ),
            badges: [
              {
                label: "Remove from ramp schedule",
                action: "remove ramp",
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
  let ctaCopy = "Request Review";
  if (approved && !hasNextStep) {
    ctaCopy = "Publish";
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
            {revision.contributors && revision.contributors.length > 0 && (
              <div className="mb-3">
                <strong style={{ fontSize: "0.85rem" }}>Contributors</strong>
                <Flex align="center" gap="2" wrap="wrap" mt="1">
                  {[revision.createdBy, ...revision.contributors]
                    .filter(
                      (u): u is EventUserLoggedIn | EventUserApiKey =>
                        u != null &&
                        (u.type === "dashboard" || u.type === "api_key"),
                    )
                    .filter(
                      (u, idx, arr) =>
                        arr.findIndex(
                          (x) => "id" in x && "id" in u && x.id === u.id,
                        ) === idx,
                    )
                    .map((lu) => {
                      return (
                        <Flex
                          key={"id" in lu ? lu.id : lu.apiKey}
                          align="center"
                          gap="1"
                          wrap="wrap"
                        >
                          <EventUser
                            user={lu}
                            display="avatar-name-email"
                            size="sm"
                          />
                        </Flex>
                      );
                    })}
                </Flex>
              </div>
            )}
            {canAdminPublish && (
              <div className="mt-3 mb-4 ml-1">
                <Checkbox
                  label="Bypass approval requirement to publish (optional for Admins only)"
                  value={adminPublish}
                  setValue={(val) => setAdminPublish(!!val)}
                />
              </div>
            )}

            {experimentsStep && approved ? (
              <div>
                <h3>Review &amp; Publish</h3>
                <p>
                  Please review the <strong>Pre-Launch Checklists</strong> for
                  the experiments that will be published along with this draft.
                </p>
                {experimentData.map(({ experiment, checklist }) => {
                  if (!selectedExperiments.has(experiment.id)) return null;

                  return (
                    <div key={experiment.id} className="mb-3">
                      <PreLaunchChecklistFeatureExpRule
                        experiment={experiment}
                        mutateExperiment={mutate}
                        checklist={checklist}
                        envs={getAffectedEnvsForExperiment({
                          experiment,
                          orgEnvironments: allEnvironments,
                          linkedFeatures: [],
                        })}
                      />
                    </div>
                  );
                })}
              </div>
            ) : (
              <>
                {approved && experimentData.length > 0 ? (
                  <div className="mb-3">
                    <h4>Start running experiments upon publishing:</h4>
                    {experimentData.map(({ experiment }) => (
                      <div key={experiment.id}>
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
                      </div>
                    ))}
                  </div>
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
