import { FeatureInterface } from "back-end/types/feature";
import { useState, useMemo, useRef } from "react";
import { FeatureRevisionInterface } from "back-end/types/feature-revision";
import { autoMerge, mergeResultHasChanges } from "shared/util";
import { useForm } from "react-hook-form";
import { ReviewSubmittedType } from "@/../back-end/src/models/FeatureRevisionModel";

import { EventAuditUserLoggedIn } from "back-end/src/events/event-types";
import { useEnvironments } from "@/services/features";
import { useAuth } from "@/services/auth";
import usePermissions from "@/hooks/usePermissions";
import { getCurrentUser } from "@/services/UserContext";
import Modal from "../Modal";
import Field from "../Forms/Field";
import Button from "../Button";
import RadioSelector from "../Forms/RadioSelector";
import { ExpandableDiff } from "./DraftModal";
import Revisionlog from "./RevisionLog";
export interface Props {
  feature: FeatureInterface;
  version: number;
  revisions: FeatureRevisionInterface[];
  close: () => void;
  mutate: () => void;
  onPublish?: () => void;
  onDiscard?: () => void;
}

export default function RequestReviewModal({
  feature,
  version,
  revisions,
  close,
  mutate,
  onDiscard,
}: Props) {
  const environments = useEnvironments();
  const [showSubmitReview, setShowSumbmitReview] = useState(false);
  const [adminPublish, setAdminPublish] = useState(false);
  const { apiCall } = useAuth();
  const user = getCurrentUser();
  const permissions = usePermissions();

  const commentRef = useRef<HTMLInputElement>(null);
  const scrollToComment = () => {
    commentRef?.current?.scrollIntoView();
  };
  const canAdminPublish = permissions.check("bypassApprovalChecks");
  const revision = revisions.find((r) => r.version === version);
  const isPendingReview =
    revision?.status === "pending-review" ||
    revision?.status === "changes-requested";
  const createdBy = revision?.createdBy as EventAuditUserLoggedIn;
  const canReview =
    isPendingReview &&
    createdBy?.id !== user?.id &&
    permissions.check("canReview");
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
              Discard
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
            <div
              className={`callout callout-color-${
                isPendingReview ? "amber" : "gray"
              }`}
            >
              <div>Publishing to the prod environment requires approval.</div>
            </div>
            {canAdminPublish && (
              <div className="mt-3 ml-1">
                <div
                  className="d-flex"
                  style={{ color: "rgba(5, 5, 73, 0.65)" }}
                >
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
            {!canReview && (
              <div className="text-right">
                <div
                  onClick={scrollToComment}
                  style={{ cursor: "pointer" }}
                  className="text-purple mt-3"
                >
                  Leave a comment
                </div>
              </div>
            )}
            <div className="list-group mb-4 mt-4">
              <h4 className="mb-3">Diffs by Enviroment</h4>
              {resultDiffs.map((diff) => (
                <ExpandableDiff {...diff} key={diff.title} />
              ))}
            </div>
            <h4 className="mb-3"> Change Request Log</h4>

            <Revisionlog feature={feature} revision={revision} />
            {(!canReview || approved) && (
              <div className="mt-3" id="comment-section">
                <Field
                  label="Add a Comment (optional)"
                  textarea
                  placeholder="Summary of changes..."
                  value={comment}
                  ref={commentRef}
                  onChange={(e) => {
                    setComment(e.target.value);
                  }}
                />
                {(!canReview || approved) && (
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
                      await mutate();
                      close();
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
