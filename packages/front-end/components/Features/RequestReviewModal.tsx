import { FeatureInterface } from "back-end/types/feature";
import { useState, useMemo, useRef } from "react";
import { FeatureRevisionInterface } from "back-end/types/feature-revision";
import {
  autoMerge,
  filterEnvironmentsByFeature,
  mergeResultHasChanges,
} from "shared/util";
import { useForm } from "react-hook-form";
import { EventAuditUserLoggedIn } from "back-end/src/events/event-types";
import { PiCheckCircleFill, PiCircleDuotone, PiFileX } from "react-icons/pi";
import { getCurrentUser } from "@/services/UserContext";
import { useAuth } from "@/services/auth";
import { useEnvironments } from "@/services/features";
import Modal from "@/components/Modal";
import Field from "@/components/Forms/Field";
import Button from "@/components/Button";
import RadioSelector from "@/components/Forms/RadioSelector";
import { ExpandableDiff } from "@/components/Features/DraftModal";
import Revisionlog, { MutateLog } from "@/components/Features/RevisionLog";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
export interface Props {
  feature: FeatureInterface;
  version: number;
  revisions: FeatureRevisionInterface[];
  close: () => void;
  mutate: () => void;
  onPublish?: () => void;
  onDiscard?: () => void;
}
type ReviewSubmittedType = "Comment" | "Approved" | "Requested Changes";

export default function RequestReviewModal({
  feature,
  version,
  revisions,
  close,
  mutate,
  onDiscard,
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
  const createdBy = revision?.createdBy as EventAuditUserLoggedIn;
  const canReview =
    isPendingReview &&
    createdBy?.id !== user?.id &&
    permissionsUtil.canReviewFeatureDrafts(feature);
  const approved = revision?.status === "approved" || adminPublish;
  const baseRevision = revisions.find(
    (r) => r.version === revision?.baseVersion
  );
  const liveRevision = revisions.find((r) => r.version === feature.version);

  const mergeResult = useMemo(() => {
    if (!revision || !baseRevision || !liveRevision) return null;
    return autoMerge(
      liveRevision,
      baseRevision,
      revision,
      environments.map((e) => e.id),
      {}
    );
  }, [revision, baseRevision, liveRevision, environments]);

  const [comment, setComment] = useState("");
  const submitReviewform = useForm<{
    reviewStatus: ReviewSubmittedType;
    comment: string;
  }>({
    defaultValues: {
      reviewStatus: "Comment",
    },
  });
  const submitButton = async () => {
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
    } else if (approved) {
      try {
        await apiCall(`/feature/${feature.id}/${revision?.version}/publish`, {
          method: "POST",
          body: JSON.stringify({
            mergeResultSerialized: JSON.stringify(mergeResult),
            comment,
            adminOverride: adminPublish,
          }),
        });
      } catch (e) {
        mutate();
        throw e;
      }
      await mutate();
    } else if (canReview) {
      setShowSumbmitReview(true);
    }
  };

  const resultDiffs = useMemo(() => {
    const diffs: { a: string; b: string; title: string }[] = [];

    if (!mergeResult) return diffs;
    if (!mergeResult.success) return diffs;

    const result = mergeResult.result;

    if (result.defaultValue !== undefined) {
      diffs.push({
        title: "Default Value",
        a: feature.defaultValue,
        b: result.defaultValue,
      });
    }
    if (result.rules) {
      environments.forEach((env) => {
        const liveRules = feature.environmentSettings?.[env.id]?.rules || [];
        if (result.rules && result.rules[env.id]) {
          diffs.push({
            title: `Rules - ${env.id}`,
            a: JSON.stringify(liveRules, null, 2),
            b: JSON.stringify(result.rules[env.id], null, 2),
          });
        }
      });
    }

    return diffs;
  }, [
    environments,
    feature.defaultValue,
    feature.environmentSettings,
    mergeResult,
  ]);

  if (!revision || !mergeResult) return null;

  const hasChanges = mergeResultHasChanges(mergeResult);
  let ctaCopy = "Request Review";
  if (approved) {
    ctaCopy = "Publish";
  } else if (canReview) {
    ctaCopy = "Next";
  }
  const showRevisionStatus = () => {
    switch (revision.status) {
      case "approved":
        return (
          <div className="alert alert-success">
            <span className="h4">
              <PiCheckCircleFill className="mr-1" /> Approved
            </span>
          </div>
        );
      case "pending-review":
        return (
          <div className="alert alert-warning">
            <span className="h4">
              <PiCircleDuotone className="mr-1" /> Pending Review
            </span>
            <div></div>
          </div>
        );
      case "changes-requested":
        return (
          <div className="alert alert-danger">
            <span className="h4">
              <PiFileX className="mr-1" /> Changes Requested
            </span>
          </div>
        );
      case "draft":
        return (
          <div className="alert alert-warning">
            <span className="h5">Publishing requires approval.</span>
          </div>
        );
      default:
        return;
    }
  };
  const renderRequestAndViewModal = () => {
    return (
      <Modal
        open={true}
        header={"Review Draft Changes"}
        cta={ctaCopy}
        close={close}
        autoCloseOnSubmit={canReview ? false : true}
        closeCta="Cancel"
        size="lg"
        submit={
          !isPendingReview || canReview || approved ? submitButton : undefined
        }
        secondaryCTA={
          isPendingReview && !canReview ? (
            <Button
              color="danger"
              onClick={async () => {
                try {
                  await apiCall(
                    `/feature/${feature.id}/${revision.version}/discard`,
                    {
                      method: "POST",
                    }
                  );
                } catch (e) {
                  await mutate();
                  throw e;
                }
                await mutate();
                onDiscard && onDiscard();
                close();
              }}
            >
              Discard Draft
            </Button>
          ) : undefined
        }
      >
        {mergeResult.conflicts.length > 0 && (
          <div className="alert alert-danger">
            <strong>Conflicts Detected</strong>. Please fix conflicts before
            publishing this draft.
          </div>
        )}

        {!hasChanges && !mergeResult.conflicts.length && (
          <div className="alert alert-info">
            There are no changes to publish. Either discard the draft or add
            changes first before publishing.
          </div>
        )}

        {mergeResult.success && hasChanges && (
          <div>
            <div className="mb-2">{showRevisionStatus()}</div>
            {canAdminPublish && (
              <div className="mt-3 mb-4 ml-1">
                <div className="d-flex">
                  <input
                    type="checkbox"
                    className="mr-2"
                    checked={adminPublish}
                    onChange={async (e) => setAdminPublish(e.target.checked)}
                  />
                  <span className="font-weight-bold mr-1">
                    Bypass approval requirement to publish
                  </span>
                  (optional for Admins only)
                </div>
              </div>
            )}

            <div className="list-group mb-4">
              <h4 className="mb-3">Diffs by Enviroment</h4>
              {resultDiffs.map((diff) => (
                <ExpandableDiff {...diff} key={diff.title} />
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
                {((!canReview && revision?.status !== "draft") || approved) && (
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
                          }
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
          </div>
        )}
      </Modal>
    );
  };
  const renderReviewAndSubmitModal = () => {
    return (
      <Modal
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
              }
            );
          } catch (e) {
            mutate();
            throw e;
          }
          await mutate();
        })}
        secondaryCTA={
          <Button
            color="outline"
            onClick={async () => setShowSumbmitReview(false)}
          >
            Back
          </Button>
        }
      >
        <div style={{ padding: "0 30px" }}>
          <div>
            <h4>Leave a Comment</h4>
            <Field
              placeholder="leave a comment"
              textarea
              className="mb-3 mt-3"
              {...submitReviewform.register("comment")}
            />
          </div>

          <RadioSelector
            name="type"
            value={submitReviewform.watch("reviewStatus")}
            descriptionNewLine={true}
            setValue={(val: ReviewSubmittedType) => {
              submitReviewform.setValue("reviewStatus", val);
            }}
            options={[
              {
                key: "Comment",
                display: "Comment",
                description:
                  "Submit general feedback without explicit approval.",
              },
              {
                key: "Requested Changes",
                display: "Request Changes",
                description:
                  "Submit feedback that must be addressed before publishing.",
              },
              {
                key: "Approved",
                display: "Approve",
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
