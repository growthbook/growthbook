import { FeatureInterface } from "shared/types/feature";
import { useState, useMemo, useRef } from "react";
import { FeatureRevisionInterface } from "shared/types/feature-revision";
import {
  autoMerge,
  filterEnvironmentsByFeature,
  getAffectedEnvsForExperiment,
  mergeResultHasChanges,
} from "shared/util";
import { useForm } from "react-hook-form";
import { EventUserLoggedIn } from "shared/types/events/event-types";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { FaArrowLeft } from "react-icons/fa";
import { Flex } from "@radix-ui/themes";
import { getCurrentUser } from "@/services/UserContext";
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
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import {
  useFeatureRevisionDiff,
  featureToFeatureRevisionDiffInput,
} from "@/hooks/useFeatureRevisionDiff";
import Badge from "@/ui/Badge";
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
}
type ReviewSubmittedType = "Comment" | "Approved" | "Requested Changes";

export default function RequestReviewModal({
  feature,
  version,
  revisions,
  close,
  mutate,
  experimentsMap,
}: Props) {
  const allEnvironments = useEnvironments();
  const environments = filterEnvironmentsByFeature(allEnvironments, feature);
  const [showSubmitReview, setShowSumbmitReview] = useState(false);
  const [adminPublish, setAdminPublish] = useState(false);
  const revisionLogRef = useRef<MutateLog>(null);
  const commentInputRef = useRef<HTMLInputElement>(null);

  const { apiCall } = useAuth();
  const user = getCurrentUser();
  const permissionsUtil = usePermissionsUtil();
  const canAdminPublish = permissionsUtil.canBypassApprovalChecks(feature);
  const revision = revisions.find((r) => r.version === version);
  const isPendingReview =
    revision?.status === "pending-review" ||
    revision?.status === "changes-requested";
  const createdBy = revision?.createdBy as EventUserLoggedIn;
  const canReview =
    isPendingReview &&
    createdBy?.id !== user?.id &&
    permissionsUtil.canReviewFeatureDrafts(feature);
  const approved = revision?.status === "approved" || adminPublish;
  const baseRevision = revisions.find(
    (r) => r.version === revision?.baseVersion,
  );
  const liveRevision = revisions.find((r) => r.version === feature.version);

  const mergeResult = useMemo(() => {
    if (!revision || !baseRevision || !liveRevision) return null;
    return autoMerge(
      liveRevision,
      baseRevision,
      revision,
      environments.map((e) => e.id),
      {},
    );
  }, [revision, baseRevision, liveRevision, environments]);

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
  const resultDiffs = useFeatureRevisionDiff({
    current: currentRevisionData,
    draft: mergeResult?.success
      ? {
          // Use current values as fallback when merge result doesn't have changes
          defaultValue:
            mergeResult.result.defaultValue ?? currentRevisionData.defaultValue,
          rules: mergeResult.result.rules ?? currentRevisionData.rules,
        }
      : currentRevisionData,
  });

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
      close();
    } else if (canReview) {
      setShowSumbmitReview(true);
    } else {
      close();
    }
  };

  if (!revision || !mergeResult) return null;

  const hasChanges = mergeResultHasChanges(mergeResult);
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

        {!hasChanges && !mergeResult.conflicts.length && (
          <Callout status="info">
            There are no changes to publish. Either discard the draft or add
            changes first before publishing.
          </Callout>
        )}

        {mergeResult.success && hasChanges && (
          <div>
            <div className="mb-2">{showRevisionStatus()}</div>
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
                {resultDiffs.length > 0 && (
                  <>
                    <h4 className="mb-3">Summary of changes</h4>
                    {resultDiffs.flatMap((d) => d.badges ?? []).length > 0 && (
                      <Flex wrap="wrap" gap="2" className="mb-3">
                        {resultDiffs
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
                    {resultDiffs.some((d) => d.customRender) && (
                      <div className="list-group mb-4">
                        {resultDiffs
                          .filter((d) => d.customRender)
                          .map((d) => (
                            <div
                              key={d.title}
                              className="list-group-item list-group-item-light pb-3"
                            >
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
                  {resultDiffs.map((diff) => (
                    <ExpandableDiff
                      key={diff.title}
                      title={diff.title}
                      a={diff.a}
                      b={diff.b}
                      styles={COMPACT_DIFF_STYLES}
                    />
                  ))}
                </div>
                <h4 className="mb-3"> Change Request Log</h4>
                <Revisionlog
                  feature={feature}
                  revision={revision}
                  ref={revisionLogRef}
                />
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
                description: "Submit feedback and approve for publishing.",
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
